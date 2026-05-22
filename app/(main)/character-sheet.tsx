import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
// ScrollView from gesture-handler, not react-native. RN's ScrollView gets
// its responder stuck after a Modal dismiss on Android, eating the next
// tap as a potential scroll. See app/(main)/quest-board/[id].tsx for the
// full note.
import { ScrollView, Pressable as GHPressable } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ModifierCard } from '../../components/modifier-card';
import {
  regenerateCampaignArcName,
  regenerateCharacterTitle,
  regenerateFactionName,
} from '../../lib/regenerate';
import { useAnimatedNumber } from '../../lib/animated-number';
import { useAuth } from '../../lib/auth';
import {
  createCampaign,
  createFaction,
  deleteCampaign,
  deleteFaction,
  reorderCampaigns,
  reorderFactions,
  updateCampaign,
  updateDifficulty,
  updateFaction,
  updateIdentity,
} from '../../lib/character-sheet';
import { ReorderableRow } from '../../components/reorderable-row';
import { CollapsibleSection } from '../../components/collapsible-section';
import { listCampaignAchievements } from '../../lib/campaign-achievements';
import {
  listActiveBuffs,
  listActiveDebuffs,
  refreshDebuffs,
  restUser,
  type ActiveModifier,
} from '../../lib/debuffs';
import { confirmDestructive, showInfoMessage } from '../../lib/dialogs';
import { ACHIEVEMENTS } from '../../lib/engine/achievements';
import { loadAchievementSnapshot } from '../../lib/engine/achievementTriggers';
import { calculateLevel, levelProgressFraction, type Difficulty } from '../../lib/engine/xp';
import { formatXp } from '../../lib/numbers';
import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import {
  getActiveQuestCount,
  getCurrentProfile,
  listCampaigns,
  listFactions,
} from '../../lib/profile';
import type { Campaign, Faction, Profile } from '../../lib/types/models';

interface SheetData {
  profile: Profile | null;
  factions: Faction[];
  campaigns: Campaign[];
  activeQuests: number;
  buffs: ActiveModifier[];
  debuffs: ActiveModifier[];
  /** Counts for the "Achievements: N / 24 + X arcs" line. Null while loading
   *  the snapshot the first time; the line just renders without it then. */
  achievements: { earnedCount: number; totalCount: number; arcCount: number } | null;
}

const DIFFICULTIES: Difficulty[] = ['apprentice', 'adept', 'master', 'legendary'];

// XP modifiers per difficulty, surfaced next to each option in the
// difficulty picker so the trade-off is visible at the moment of choice.
// Source of truth for the actual modifier math lives in lib/engine/xp.ts;
// this constant is display-only.
const DIFFICULTY_XP_MULTIPLIERS: Record<Difficulty, string> = {
  apprentice: '1.5×',
  adept: '1.25×',
  master: '1.0×',
  legendary: '0.75×',
};

// Sentinel for "user is composing a new row"; kept separate from a real id so
// we never confuse a draft with a saved record.
const DRAFT_ID = '__draft__';

export default function CharacterSheet() {
  const { session, refetchProfile } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Inline-edit state. Only one row of each type can be in edit mode at once.
  const [editingFactionId, setEditingFactionId] = useState<string | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  // Drag-to-reorder is opt-in per section. The drag handles only render
  // when these are true (toggled by Reorder/Done buttons next to the
  // section titles), so the cards aren't shifted left by the handle bar
  // by default. Reorder commits on drag release; toggling Done back off
  // doesn't undo anything, it just hides the handles.
  const [reorderingFactions, setReorderingFactions] = useState(false);
  const [reorderingCampaigns, setReorderingCampaigns] = useState(false);
  const [busy, setBusy] = useState(false);
  // Dropdown state for the Difficulty selector. Modal opens on trigger
  // press; tapping an option closes it and applies the change.
  const [difficultyOpen, setDifficultyOpen] = useState(false);
  // Inline name + title editor. Opened from the Edit affordance next to the
  // chronicler's name at the top. State is seeded from the current profile
  // when the modal opens. Includes a "Regenerate title" button that asks
  // the Archivist for a fresh take, ignoring the user's typed title.
  const [identityEditorOpen, setIdentityEditorOpen] = useState(false);
  const [identityName, setIdentityName] = useState('');
  const [identityTitle, setIdentityTitle] = useState('');
  const [identityBusy, setIdentityBusy] = useState<'save' | 'regen' | null>(null);
  // Per-faction / per-campaign regenerate-in-flight tracking. Lets us dim
  // the specific row whose name is being asked for, leaving siblings tappable.
  const [regenFactionId, setRegenFactionId] = useState<string | null>(null);
  const [regenCampaignId, setRegenCampaignId] = useState<string | null>(null);

  // Tick the displayed XP from its previous value to the new total when
  // a quest completes. Must be called before any early returns to satisfy
  // hooks rules. Falls back to 0 when the profile hasn't loaded yet.
  // The hook returns a smooth float; text uses Math.round, but the bar
  // width derives from the raw float so it glides continuously even when
  // the rounded number text snaps integer-by-integer.
  const totalXp = data?.profile?.total_xp ?? 0;
  // ready=false while data is still loading; prevents the fallback-zero
  // load transition from animating. persistKey lets the hook remember
  // what the user last SAW across screen mounts:
  //   - First-ever mount: no cache, snap to total (no animation).
  //   - Returning mount with same total: cache match, no animation.
  //   - Returning mount with higher total (XP earned while away): cache
  //     misses target, animate from cached value up to the new total.
  // Scoped per user id so multiple sign-ins on the same device don't
  // bleed XP totals between chronicles.
  const xpPersistKey = session?.user.id ? `xp:${session.user.id}` : undefined;
  const animatedTotalXpFloat = useAnimatedNumber(totalXp, 900, !!data, xpPersistKey);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const profile = await getCurrentProfile();
      // Reconcile time-based debuffs before listing so the user always sees
      // a fresh picture, even before the daily cron exists.
      if (profile) {
        try {
          await refreshDebuffs(profile.id);
        } catch (e) {
          // Non-fatal, fall back to whatever's already on file.
          console.warn('refreshDebuffs failed', e);
        }
      }
      const [factions, campaigns, activeQuests, buffs, debuffs] = await Promise.all([
        listFactions(),
        listCampaigns('active'),
        getActiveQuestCount(),
        listActiveBuffs(),
        listActiveDebuffs(),
      ]);
      // Achievement counts shown on the sheet are best-effort, render the
      // sheet even if this fails so the user still sees their character.
      // Personal trophies (campaign_achievements) roll into both sides of
      // the ratio: each one bumps numerator and denominator together, so
      // the "X / Y inscribed" line reflects the full ledger rather than
      // hiding Personals behind a separate count.
      let achievements: SheetData['achievements'] = null;
      if (profile) {
        try {
          const [snap, personalRows] = await Promise.all([
            loadAchievementSnapshot(profile.id),
            listCampaignAchievements().catch(() => []),
          ]);
          const earnedCodes = new Set(snap.earned.map((r) => r.code));
          const totalPredefined = ACHIEVEMENTS.filter((a) => !a.isTemplate).length;
          const earnedPredefined = ACHIEVEMENTS.filter(
            (a) => !a.isTemplate && earnedCodes.has(a.code),
          ).length;
          const arcCount = snap.earned.filter((r) => r.code === 'arc_completed').length;
          const personalCount = personalRows.length;
          achievements = {
            earnedCount: earnedPredefined + personalCount,
            totalCount: totalPredefined + personalCount,
            arcCount,
          };
        } catch (e) {
          console.warn('achievement snapshot failed', e);
        }
      }
      setData({ profile, factions, campaigns, activeQuests, buffs, debuffs, achievements });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void refresh().then(() => {
        if (cancelled) return;
      });
      return () => {
        cancelled = true;
      };
    }, [refresh]),
  );

  const onSetDifficulty = async (next: Difficulty) => {
    if (!data?.profile || data.profile.difficulty === next) return;
    setActionError(null);
    setBusy(true);
    try {
      await updateDifficulty(next);
      await Promise.all([refetchProfile(), refresh()]);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onOpenIdentityEditor = () => {
    setIdentityName(data?.profile?.character_name ?? '');
    setIdentityTitle(data?.profile?.character_title ?? '');
    setActionError(null);
    setIdentityEditorOpen(true);
  };

  const onSaveIdentity = async () => {
    if (!data?.profile) return;
    setActionError(null);
    setIdentityBusy('save');
    try {
      await updateIdentity({
        character_name: identityName.trim() || data.profile.character_name || 'Wanderer',
        character_title: identityTitle.trim() ? identityTitle.trim() : null,
      });
      await Promise.all([refetchProfile(), refresh()]);
      setIdentityEditorOpen(false);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setIdentityBusy(null);
    }
  };

  const onRegenerateTitle = async () => {
    if (!data?.profile) return;
    setActionError(null);
    setIdentityBusy('regen');
    try {
      const next = await regenerateCharacterTitle({
        name: identityName.trim() || data.profile.character_name || 'Wanderer',
        current_title: identityTitle.trim() || data.profile.character_title || null,
        background: null, // backstory isn't on the profile; AI works from name + title context
        proficiencies: null,
        life_summary: null,
      });
      setIdentityTitle(next);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setIdentityBusy(null);
    }
  };

  const onReorderFactions = async (from: number, to: number) => {
    if (!data?.factions || from === to) return;
    // Optimistic local reorder, then persist. The next refresh confirms.
    const arr = [...data.factions];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setData({ ...data, factions: arr });
    try {
      await reorderFactions(arr.map((f) => f.id));
    } catch (e) {
      setActionError(errorMessage(e));
      void refresh();
    }
  };

  const onReorderCampaigns = async (from: number, to: number) => {
    if (!data?.campaigns || from === to) return;
    const arr = [...data.campaigns];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setData({ ...data, campaigns: arr });
    try {
      await reorderCampaigns(arr.map((c) => c.id));
    } catch (e) {
      setActionError(errorMessage(e));
      void refresh();
    }
  };

  const onRegenerateFactionName = async (faction: Faction) => {
    if (!faction.real_world_domain?.trim()) {
      setActionError('This faction has no real-world domain to draw from.');
      return;
    }
    setActionError(null);
    setRegenFactionId(faction.id);
    try {
      const newName = await regenerateFactionName({
        real_world_domain: faction.real_world_domain,
        current_name: faction.name,
      });
      await updateFaction(faction.id, {
        name: newName,
        real_world_domain: faction.real_world_domain,
        reputation_title: faction.reputation_title,
      });
      await refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setRegenFactionId(null);
    }
  };

  const onRegenerateCampaignName = async (campaign: Campaign) => {
    if (!campaign.real_world_goal?.trim()) {
      setActionError('This campaign has no real-world goal to draw from.');
      return;
    }
    setActionError(null);
    setRegenCampaignId(campaign.id);
    try {
      const newArcName = await regenerateCampaignArcName({
        real_world_goal: campaign.real_world_goal,
        current_arc_name: campaign.arc_name,
      });
      await updateCampaign(campaign.id, {
        arc_name: newArcName,
        real_world_goal: campaign.real_world_goal,
        progress_pct: campaign.progress_pct,
        status: campaign.status,
      });
      await refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setRegenCampaignId(null);
    }
  };

  const onRest = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const result = await restUser();
      await refresh();
      await showInfoMessage(
        result.clearedCount > 0 ? 'You rest' : 'You rest, but nothing was old enough',
        result.clearedCount > 0
          ? `${result.clearedCount} stale debuff${result.clearedCount === 1 ? '' : 's'} dispelled. Next rest available after ${formatRestDate(result.nextRestAvailableAt)}.`
          : `Debuffs older than 14 days are cleared on rest. Next rest available after ${formatRestDate(result.nextRestAvailableAt)}.`,
      );
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-body text-red-700">{error}</Text>
        </View>
      </ParchmentScreen>
    );
  }
  if (!data) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#92400e" />
        </View>
      </ParchmentScreen>
    );
  }

  const { profile, factions, campaigns, activeQuests, buffs, debuffs, achievements } = data;
  const restCooldownMs = 7 * 24 * 60 * 60 * 1000;
  const restAvailableAt = profile?.last_rest_at
    ? new Date(profile.last_rest_at).getTime() + restCooldownMs
    : 0;
  const restOnCooldown = Date.now() < restAvailableAt;
  // Round the float for level + integer text values. The bar is driven
  // separately by Reanimated (see AnimatedXpBar below) so its width
  // doesn't ride React's render loop, feeding a percentage style object
  // through the reconciler each frame produced visible stutter on web,
  // even though the text counter (using the same source) read smooth.
  const animatedTotalXp = Math.round(animatedTotalXpFloat);
  const { level, currentLevelXp, nextLevelXp } = calculateLevel(animatedTotalXp);
  const atMaxLevel = nextLevelXp === 0;

  const displayName =
    profile?.character_name ?? profile?.display_name ?? session?.user.email ?? 'Wanderer';

  const showFactionDraft = editingFactionId === DRAFT_ID;
  const showCampaignDraft = editingCampaignId === DRAFT_ID;

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
      <View className="mb-1 flex-row items-baseline justify-between">
        <Text className="font-display text-4xl text-stone-900">{displayName}</Text>
        {profile?.character_name ? (
          <Pressable
            onPress={onOpenIdentityEditor}
            className="active:opacity-60"
            accessibilityRole="button"
            accessibilityLabel="Edit name and title"
          >
            <Text className="font-body text-base text-amber-800">Edit ✎</Text>
          </Pressable>
        ) : null}
      </View>
      {profile?.character_title ? (
        <Text className="mb-6 font-display text-amber-800">{profile.character_title}</Text>
      ) : (
        <Text className="mb-6 font-body italic text-stone-500">Untitled, for now.</Text>
      )}

      {actionError ? (
        <View className="mb-4 rounded-md border border-red-900 bg-red-950 px-4 py-3">
          <Text className="font-body text-xl text-red-700">{actionError}</Text>
        </View>
      ) : null}

      {/* Level + XP bar */}
      <View className="mb-8 rounded-md border border-stone-800 bg-amber-50/40 p-4">
        <View className="mb-2 flex-row items-baseline justify-between">
          <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
            Level
          </Text>
          <Text className="font-display-bold text-2xl text-stone-900">{level}</Text>
        </View>
        <AnimatedXpBar targetFraction={atMaxLevel ? 1 : levelProgressFraction(totalXp)} />
        <Text className="font-body text-lg text-stone-500">
          {atMaxLevel
            ? 'Max level reached'
            : `${formatXp(currentLevelXp)} / ${formatXp(nextLevelXp)} XP`}
        </Text>
        <Pressable
          onPress={() => router.push('/xp-history')}
          className="mt-3 active:opacity-60"
        >
          <Text className="font-body text-lg text-amber-800">View XP history →</Text>
        </Pressable>
      </View>

      {/* Active quests */}
      <View className="mb-8 rounded-md border border-stone-800 bg-amber-50/40 p-4">
        <Text className="mb-1 font-display text-lg uppercase tracking-widest text-stone-700">
          Active quests
        </Text>
        <Text className="font-display-bold text-2xl text-stone-900">{activeQuests}</Text>
      </View>

      {/* Achievements, counts plus tap-to-open. The arc count appears as
          a "+ X arcs" suffix when the chronicler has any. */}
      <Pressable
        onPress={() => router.push('/achievements')}
        className="mb-8 rounded-md border border-stone-800 bg-amber-50/40 p-4 active:bg-amber-100/60"
      >
        <Text className="mb-1 font-display text-lg uppercase tracking-widest text-stone-700">
          Achievements
        </Text>
        {achievements ? (
          <Text className="font-display-bold text-2xl text-stone-900">
            {achievements.earnedCount} / {achievements.totalCount}
            {achievements.arcCount > 0 ? (
              <Text className="font-body text-lg text-amber-800">
                {`  + ${achievements.arcCount} arc${achievements.arcCount === 1 ? '' : 's'}`}
              </Text>
            ) : null}
          </Text>
        ) : (
          <Text className="font-body italic text-stone-500">Loading the ledger…</Text>
        )}
        <Text className="mt-1 font-body text-base text-amber-800">View the ledger →</Text>
      </Pressable>

      {/* Attributes, placeholder for v1.1+. Same dimmed "coming soon" treatment
          as Perk Tree below. D&D-style six (STR/DEX/CON/INT/WIS/CHA) since the
          chronicler asked for "DnD and Fallout" style, the six are the most
          universally recognized. Values render as em-dashes so it reads as a
          real stat sheet that isn't filled in yet, not an empty placeholder. */}
      <CollapsibleSection
        id="char-attributes"
        title="Attributes"
        className="mb-8"
        headerRight={
          <View className="rounded-full border border-amber-700 bg-amber-100/60 px-2.5 py-0.5">
            <Text className="font-display text-xs uppercase tracking-widest text-amber-800">
              Coming Soon
            </Text>
          </View>
        }
      >
        <View className="rounded-md border border-amber-900/30 bg-amber-50/20 p-4">
          <View className="mb-3 flex-row flex-wrap">
            {[
              { key: 'STR', name: 'Strength' },
              { key: 'DEX', name: 'Dexterity' },
              { key: 'CON', name: 'Constitution' },
              { key: 'INT', name: 'Intellect' },
              { key: 'WIS', name: 'Wisdom' },
              { key: 'CHA', name: 'Charisma' },
            ].map((attr) => (
              <View key={attr.key} className="mb-2 w-1/3 items-center">
                <Text className="font-display text-xs uppercase tracking-widest text-amber-800/70">
                  {attr.key}
                </Text>
                <Text className="font-display-bold text-2xl text-stone-500">-</Text>
                <Text className="font-body text-xs italic text-stone-500">{attr.name}</Text>
              </View>
            ))}
          </View>
          <Text className="font-body text-lg italic text-stone-600">
            Quests will one day temper the chronicler's traits, sharpened wit from study, hardened
            sinew from labor, silvered tongue from parley. The Archivist still measures the
            weights.
          </Text>
        </View>
      </CollapsibleSection>

      {/* Perk Tree, placeholder for v1.1+. Non-interactive teaser that
          seeds anticipation for both free chroniclers (a glimpse of what
          Hero will unlock) and Hero subscribers (signaling that more is
          on the way). Visually dimmer than the active sections so it
          reads as "coming, not here yet" without an explicit lock icon. */}
      <CollapsibleSection
        id="char-perk-tree"
        title="Perk Tree"
        className="mb-8"
        headerRight={
          <View className="rounded-full border border-amber-700 bg-amber-100/60 px-2.5 py-0.5">
            <Text className="font-display text-xs uppercase tracking-widest text-amber-800">
              Coming Soon
            </Text>
          </View>
        }
      >
        <View className="rounded-md border border-amber-900/30 bg-amber-50/20 p-4">
          <Text className="font-body text-lg italic text-stone-600">
            The Archivist is weaving a new branch of boons into the chronicle. Soon, each
            chronicler will chart their own path of power.
          </Text>
        </View>
      </CollapsibleSection>

      {/* Buffs, earned by completing quests under their granted-buff
          conditions. Persist for a tier-scaled lifetime; stack while
          active. Always render the section with an empty state so the
          layout matches Debuffs below, consistency was a tester request. */}
      <CollapsibleSection id="char-buffs" title="Buffs" className="mb-8">
        <View className="gap-2">
          {buffs.length === 0 ? (
            <Text className="font-body italic text-stone-500">
              No buffs. Earn them by completing quests on time.
            </Text>
          ) : (
            buffs.map((b) => (
              <ModifierCard
                key={b.id}
                modifier={b}
                remainingLabel={formatBuffRemaining(b.expires_at)}
              />
            ))
          )}
        </View>
      </CollapsibleSection>

      {/* Debuffs, visible whenever any are active. Rest button always
          renders inside the section but disables on cooldown. Living inside
          the section (rather than the header) keeps the collapsed header
          tidy and aligns with the chronicler's "actions appear when you
          open the menu" pattern. */}
      <CollapsibleSection id="char-debuffs" title="Debuffs" className="mb-8">
        <View className="gap-2">
          {debuffs.length === 0 ? (
            <Text className="font-body italic text-stone-500">
              No debuffs. Keep tending the Tome.
            </Text>
          ) : (
            debuffs.map((d) => <ModifierCard key={d.id} modifier={d} />)
          )}
          <Pressable
            onPress={onRest}
            disabled={busy || restOnCooldown}
            className={`mt-1 self-start rounded-md border px-3 py-1.5 ${
              busy || restOnCooldown
                ? 'border-stone-800 bg-amber-50/40'
                : 'border-amber-700 bg-amber-900/40 active:bg-amber-900/60'
            }`}
          >
            <Text
              className={`font-body-medium text-lg uppercase tracking-widest ${
                busy || restOnCooldown ? 'text-stone-500' : 'text-amber-800'
              }`}
            >
              {restOnCooldown
                ? `Rest avail. ${formatRestDate(new Date(restAvailableAt).toISOString())}`
                : '+rest'}
            </Text>
          </Pressable>
        </View>
      </CollapsibleSection>

      {/* Factions. Reorder + Add buttons live inside the open menu, not on
          the collapsed header, so the header stays clean. The action row
          renders above the list of factions because that's where the eye
          lands when the user opens the section. */}
      <CollapsibleSection id="char-factions" title="Factions" className="mb-8">
        <View className="mb-2 flex-row items-center justify-end gap-3">
          {factions.length > 1 && editingFactionId === null ? (
            // GHPressable: flipping reorder mode mounts new GestureDetectors
            // beneath, and RN's stock Pressable leaves the responder stuck
            // after the tap. className dropped by GHPressable, styling
            // moves to a wrapping View.
            <GHPressable onPress={() => setReorderingFactions((v) => !v)}>
              <View className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-1">
                <Text className="font-body text-base text-stone-700">
                  {reorderingFactions ? 'Done' : 'Reorder'}
                </Text>
              </View>
            </GHPressable>
          ) : null}
          {!showFactionDraft && editingFactionId === null ? (
            <Pressable
              onPress={() => setEditingFactionId(DRAFT_ID)}
              className="active:opacity-60"
            >
              <Text className="font-body text-lg text-amber-800">+ Add</Text>
            </Pressable>
          ) : null}
        </View>
      <View className="gap-2">
        {factions.length === 0 && !showFactionDraft ? (
          <Text className="font-body italic text-stone-500">
            The Archivist will inscribe these during character creation.
          </Text>
        ) : null}
        {factions.map((f, idx) =>
          editingFactionId === f.id ? (
            <FactionEditor
              key={f.id}
              initial={f}
              busy={busy}
              onSave={async (patch) => {
                setActionError(null);
                setBusy(true);
                try {
                  await updateFaction(f.id, patch);
                  await refresh();
                  setEditingFactionId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onDelete={async () => {
                const ok = await confirmDestructive(
                  'Disband faction?',
                  `"${f.name}" will be unlinked from any quests under it. This can't be undone.`,
                );
                if (!ok) return;
                setActionError(null);
                setBusy(true);
                try {
                  await deleteFaction(f.id);
                  await refresh();
                  setEditingFactionId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onCancel={() => setEditingFactionId(null)}
              onRegenerate={() => onRegenerateFactionName(f)}
              regenerating={regenFactionId === f.id}
            />
          ) : (
            (() => {
              // Card body is rendered once and reused whether or not we're
              // in reorder mode. In reorder mode the press still triggers
              // edit on tap, but the long-press route on the drag handle
              // owns the gesture for repositioning.
              const card = (
                <Pressable
                  onPress={() => setEditingFactionId(f.id)}
                  disabled={editingFactionId !== null || reorderingFactions}
                  className="rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
                >
                  {/* items-start so a multi-line faction name keeps the
                      reputation_title pinned to the top, not floating against
                      the last wrapped line. flex-1 on the title lets it wrap
                      to as many lines as needed. shrink-0 + numberOfLines={1}
                      on the rep title keeps it whole on the right, the title
                      yields space, not the rep title. */}
                  <View className="flex-row items-start justify-between">
                    <Text className="flex-1 pr-3 font-body-medium text-2xl text-stone-900">
                      {f.name}
                    </Text>
                    <Text
                      className="shrink-0 font-display text-base uppercase tracking-wider text-amber-800"
                      numberOfLines={1}
                    >
                      {f.reputation_title}
                    </Text>
                  </View>
                  <Text className="font-body text-lg text-stone-500">{f.real_world_domain}</Text>
                  <Text className="mt-1 font-body text-sm text-stone-600">
                    {f.reputation_count} {f.reputation_count === 1 ? 'deed' : 'deeds'} inscribed
                  </Text>
                </Pressable>
              );
              return reorderingFactions ? (
                <ReorderableRow
                  key={f.id}
                  listKey="factions"
                  idx={idx}
                  count={factions.length}
                  rowHeight={100}
                  disabled={editingFactionId !== null}
                  onReorder={(from, to) => void onReorderFactions(from, to)}
                >
                  {card}
                </ReorderableRow>
              ) : (
                <View key={f.id}>{card}</View>
              );
            })()
          ),
        )}
        {showFactionDraft ? (
          <FactionEditor
            initial={null}
            busy={busy}
            onSave={async (patch) => {
              if (!patch.name?.trim() || !patch.real_world_domain?.trim()) return;
              setActionError(null);
              setBusy(true);
              try {
                await createFaction({
                  name: patch.name,
                  real_world_domain: patch.real_world_domain,
                });
                await refresh();
                setEditingFactionId(null);
              } catch (e) {
                setActionError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setEditingFactionId(null)}
          />
        ) : null}
        </View>
      </CollapsibleSection>

      {/* Campaigns. Same in-menu action row pattern as Factions, the Reorder
          and Add buttons live inside the expanded content so the collapsed
          header is just the title + chevron. */}
      <CollapsibleSection id="char-campaigns" title="Campaigns" className="mb-8">
        <View className="mb-2 flex-row items-center justify-end gap-3">
          {campaigns.length > 1 && editingCampaignId === null ? (
            // Same GHPressable rationale as the Factions Reorder button above.
            <GHPressable onPress={() => setReorderingCampaigns((v) => !v)}>
              <View className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-1">
                <Text className="font-body text-base text-stone-700">
                  {reorderingCampaigns ? 'Done' : 'Reorder'}
                </Text>
              </View>
            </GHPressable>
          ) : null}
          {!showCampaignDraft && editingCampaignId === null ? (
            <Pressable
              onPress={() => setEditingCampaignId(DRAFT_ID)}
              className="active:opacity-60"
            >
              <Text className="font-body text-lg text-amber-800">+ Add</Text>
            </Pressable>
          ) : null}
        </View>
        <View className="gap-2">
        {campaigns.length === 0 && !showCampaignDraft ? (
          <Text className="font-body italic text-stone-500">
            No active arcs. Forge new ones as your chronicle unfolds.
          </Text>
        ) : null}
        {campaigns.map((c, idx) =>
          editingCampaignId === c.id ? (
            <CampaignEditor
              key={c.id}
              initial={c}
              busy={busy}
              onSave={async (patch) => {
                setActionError(null);
                setBusy(true);
                try {
                  await updateCampaign(c.id, patch);
                  await refresh();
                  setEditingCampaignId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onDelete={async () => {
                const ok = await confirmDestructive(
                  'Abandon campaign?',
                  `"${c.arc_name}" will be unlinked from any quests under it. This can't be undone.`,
                );
                if (!ok) return;
                setActionError(null);
                setBusy(true);
                try {
                  await deleteCampaign(c.id);
                  await refresh();
                  setEditingCampaignId(null);
                } catch (e) {
                  setActionError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              onCancel={() => setEditingCampaignId(null)}
              onRegenerate={() => onRegenerateCampaignName(c)}
              regenerating={regenCampaignId === c.id}
            />
          ) : (
            (() => {
              const card = (
                <Pressable
                  onPress={() => setEditingCampaignId(c.id)}
                  disabled={editingCampaignId !== null || reorderingCampaigns}
                  className="rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
                >
                  {/* items-start so a multi-line arc_name keeps the % pinned
                      to the top, not floating against the last wrapped line.
                      flex-1 + no numberOfLines on the title lets it wrap
                      freely. shrink-0 + numberOfLines={1} on the % keeps it
                      whole on the right ("100%" is the widest case). */}
                  <View className="flex-row items-start justify-between">
                    <Text className="flex-1 pr-3 font-body-medium text-2xl text-stone-900">
                      {c.arc_name}
                    </Text>
                    <Text
                      className="shrink-0 font-display text-2xl text-amber-800"
                      numberOfLines={1}
                    >
                      {c.progress_pct}%
                    </Text>
                  </View>
                  <Text className="font-body text-lg text-stone-500">{c.real_world_goal}</Text>
                  {/* Always-visible progress bar so a fresh 0% campaign still
                      shows the rail it'll fill into. Thicker than before so
                      the visual is more rewarding as quests rack up. */}
                  <View className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100/60">
                    <View
                      className="h-2 rounded-full bg-amber-600"
                      style={{ width: `${Math.max(c.progress_pct, 1)}%` }}
                    />
                  </View>
                </Pressable>
              );
              return reorderingCampaigns ? (
                <ReorderableRow
                  key={c.id}
                  listKey="campaigns"
                  idx={idx}
                  count={campaigns.length}
                  rowHeight={120}
                  disabled={editingCampaignId !== null}
                  onReorder={(from, to) => void onReorderCampaigns(from, to)}
                >
                  {card}
                </ReorderableRow>
              ) : (
                <View key={c.id}>{card}</View>
              );
            })()
          ),
        )}
        {showCampaignDraft ? (
          <CampaignEditor
            initial={null}
            busy={busy}
            onSave={async (patch) => {
              if (!patch.arc_name?.trim() || !patch.real_world_goal?.trim()) return;
              setActionError(null);
              setBusy(true);
              try {
                await createCampaign({
                  arc_name: patch.arc_name,
                  real_world_goal: patch.real_world_goal,
                });
                await refresh();
                setEditingCampaignId(null);
              } catch (e) {
                setActionError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setEditingCampaignId(null)}
          />
        ) : null}
        </View>
      </CollapsibleSection>

      {/* Difficulty, dropdown selector. Tapping persists immediately and
          refetches the profile so XP-modifier changes go live everywhere.
          Used to be a 4-button segmented control but the labels (especially
          LEGENDARY) crowded the row on narrow phones, so it's now a single
          trigger + Modal-based option list. */}
      <CollapsibleSection id="char-difficulty" title="Difficulty" className="mb-8">
        <Pressable
          onPress={() => setDifficultyOpen(true)}
          disabled={busy}
          className="flex-row items-center justify-between rounded-md border border-stone-800 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
        >
          <Text className="font-display text-2xl uppercase tracking-widest text-amber-800">
            {profile?.difficulty ?? 'apprentice'}
          </Text>
          <Text className="font-body text-xl text-stone-600">▾</Text>
        </Pressable>
      </CollapsibleSection>

      {/*
        animationType="none" matches the shared DropdownPicker / DeadlinePicker
        fix. "fade" keeps the native Modal in the view hierarchy for ~250ms
        after setOpen(false), and the RN gesture responder eats the next
        tap during that window. Keep this on "none".
      */}
      <Modal
        visible={difficultyOpen}
        transparent
        animationType="none"
        onRequestClose={() => setDifficultyOpen(false)}
      >
        <Pressable
          onPress={() => setDifficultyOpen(false)}
          className="flex-1 items-center justify-center bg-stone-950/70 px-6"
        >
          <View className="w-full max-w-md rounded-md border border-amber-900 bg-amber-50 p-2">
            <Text className="mb-2 px-2 pt-2 font-display text-base uppercase tracking-widest text-stone-500">
              Choose your difficulty
            </Text>
            {DIFFICULTIES.map((d) => {
              const selected = profile?.difficulty === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => {
                    setDifficultyOpen(false);
                    if (!selected) void onSetDifficulty(d);
                  }}
                  className={`flex-row items-center justify-between rounded-md px-4 py-3 ${
                    selected ? 'bg-amber-900/30' : 'active:bg-amber-100/80'
                  }`}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    className={`mr-2 flex-1 font-body-medium text-2xl uppercase tracking-widest ${
                      selected ? 'text-amber-800' : 'text-stone-700'
                    }`}
                  >
                    {d}
                  </Text>
                  <Text
                    className={`font-display text-lg ${
                      selected ? 'text-amber-800' : 'text-stone-500'
                    }`}
                  >
                    {DIFFICULTY_XP_MULTIPLIERS[d]} XP
                  </Text>
                </Pressable>
              );
            })}
            <Text className="mt-2 px-2 pb-2 font-body text-sm italic text-stone-500">
              Harder difficulty earns less XP per quest.
            </Text>
          </View>
        </Pressable>
      </Modal>

      {/* Identity editor, name + title with a Regenerate-title button. */}
      <Modal
        visible={identityEditorOpen}
        transparent
        animationType="none"
        onRequestClose={() => setIdentityEditorOpen(false)}
      >
        <Pressable
          onPress={() => setIdentityEditorOpen(false)}
          className="flex-1 items-center justify-center bg-stone-950/70 px-6"
        >
          <Pressable onPress={() => undefined} className="w-full max-w-md">
            <View className="rounded-md border border-amber-900 bg-amber-50 p-4">
              <Text className="mb-3 font-display text-xl text-stone-900">
                Edit your identity
              </Text>

              <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
                Name
              </Text>
              <TextInput
                value={identityName}
                onChangeText={setIdentityName}
                editable={identityBusy === null}
                className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-lg text-stone-900"
              />

              <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
                Title
              </Text>
              <TextInput
                value={identityTitle}
                onChangeText={setIdentityTitle}
                editable={identityBusy === null}
                placeholder="The Archivist's bestowal, or your own"
                placeholderTextColor="#78716c"
                className="mb-2 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-lg text-stone-900"
              />
              <Pressable
                onPress={onRegenerateTitle}
                disabled={identityBusy !== null}
                className={`mb-4 self-start rounded-md border border-amber-700 px-3 py-2 ${
                  identityBusy === 'regen' ? 'bg-amber-100/40' : 'active:bg-amber-100'
                }`}
              >
                <Text className="font-body text-base text-amber-800">
                  {identityBusy === 'regen' ? 'The Archivist ponders…' : 'Regenerate title ✶'}
                </Text>
              </Pressable>

              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => setIdentityEditorOpen(false)}
                  disabled={identityBusy !== null}
                  className="flex-1 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-3 active:bg-amber-100"
                >
                  <Text className="text-center font-body text-lg text-stone-700">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={onSaveIdentity}
                  disabled={identityBusy !== null || !identityName.trim()}
                  className={`flex-1 rounded-md px-3 py-3 ${
                    identityBusy !== null || !identityName.trim()
                      ? 'bg-amber-100/40'
                      : 'bg-amber-600 active:bg-amber-700'
                  }`}
                >
                  <Text className="text-center font-body-medium text-lg text-stone-900">
                    {identityBusy === 'save' ? 'Saving…' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      </ScrollView>
    </ParchmentScreen>
  );
}

function formatRestDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * "Lasts 2 days", "Lasts 6 hours", "Expiring soon". Returns null if the
 * timestamp can't be parsed. Buff entries with no expires_at (legacy or
 * "next completion" flavor) just don't render this line.
 */
function formatBuffRemaining(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Expiring now';
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return 'Lasts < 1 hour';
  if (hours < 24) return `Lasts ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `Lasts ${days} day${days === 1 ? '' : 's'}`;
}

// ---- Inline editors --------------------------------------------------------

interface FactionEditorProps {
  initial: Faction | null;
  busy: boolean;
  onSave: (patch: {
    name?: string;
    real_world_domain?: string;
    reputation_title?: string;
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
  /** Optional: called when the chronicler taps "Regenerate name". Parent
   *  owns the AI call. Omit for the draft (new) editor since there's
   *  nothing to regenerate yet. */
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
}

function FactionEditor({
  initial,
  busy,
  onSave,
  onCancel,
  onDelete,
  onRegenerate,
  regenerating,
}: FactionEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [domain, setDomain] = useState(initial?.real_world_domain ?? '');
  const [reputation, setReputation] = useState(initial?.reputation_title ?? 'Initiate');
  const canSave = name.trim().length > 0 && domain.trim().length > 0 && !busy;
  // Reflect a freshly-regenerated name back into the local edit field
  // so the chronicler sees what the Archivist proposed before they save.
  useEffect(() => {
    if (initial?.name) setName(initial.name);
  }, [initial?.name]);

  return (
    <View className="rounded-md border border-amber-900/50 bg-amber-50/40 p-3">
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Faction name
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. The Crown Forge"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-2 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      {onRegenerate ? (
        <Pressable
          onPress={() => void onRegenerate()}
          disabled={busy || regenerating}
          className={`mb-3 self-start rounded-md border border-amber-700 px-3 py-2 ${
            regenerating ? 'bg-amber-100/40' : 'active:bg-amber-100'
          }`}
          accessibilityRole="button"
          accessibilityLabel="Regenerate faction name"
        >
          <Text className="font-body text-base text-amber-800">
            {regenerating ? 'The Archivist ponders…' : 'Regenerate name ✶'}
          </Text>
        </Pressable>
      ) : null}
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Real-world domain
      </Text>
      <TextInput
        value={domain}
        onChangeText={setDomain}
        placeholder="e.g. Day job at Acme Corp"
        placeholderTextColor="#57534e"
        editable={!busy}
        multiline
        className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Reputation title
      </Text>
      <TextInput
        value={reputation}
        onChangeText={setReputation}
        placeholder="e.g. Veteran, Senior Engineer, Master Smith"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-1 rounded-md border border-stone-700 px-3 py-2 font-body text-stone-900"
      />
      <Text className="mb-3 font-body text-sm text-stone-600">
        Your standing within this faction. Edit when your real-world rank
        changes, the Tome only counts; you name.
      </Text>
      <View className="flex-row gap-2">
        <Pressable
          onPress={() =>
            onSave({ name, real_world_domain: domain, reputation_title: reputation })
          }
          disabled={!canSave}
          className={`flex-1 rounded-md px-3 py-2 ${
            canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'
          }`}
        >
          <Text className="text-center font-body-medium text-xl text-stone-900">
            {initial ? 'Save' : 'Create'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-xl text-stone-700">Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            className="rounded-md border border-red-900 bg-amber-50/40 px-3 py-2 active:bg-red-950"
          >
            <Text className="text-center font-body text-xl text-red-700">Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

interface CampaignEditorProps {
  initial: Campaign | null;
  busy: boolean;
  onSave: (patch: {
    arc_name?: string;
    real_world_goal?: string;
    progress_pct?: number;
    status?: Campaign['status'];
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
  /** Optional: regenerate the in-voice arc name from the real-world goal. */
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
}

function CampaignEditor({
  initial,
  busy,
  onSave,
  onCancel,
  onDelete,
  onRegenerate,
  regenerating,
}: CampaignEditorProps) {
  const [arcName, setArcName] = useState(initial?.arc_name ?? '');
  const [goal, setGoal] = useState(initial?.real_world_goal ?? '');
  const [progress, setProgress] = useState(String(initial?.progress_pct ?? 0));
  const [status, setStatus] = useState<Campaign['status']>(initial?.status ?? 'active');
  const canSave = arcName.trim().length > 0 && goal.trim().length > 0 && !busy;
  // Pick up freshly-regenerated arc names so the editor reflects what the
  // Archivist proposed before the chronicler taps Save.
  useEffect(() => {
    if (initial?.arc_name) setArcName(initial.arc_name);
  }, [initial?.arc_name]);

  // Constrain to 0-100 on input rather than at submit so the user gets
  // immediate feedback if they typo a wild number.
  const onProgressChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 3);
    if (cleaned === '') {
      setProgress('');
      return;
    }
    const n = Math.max(0, Math.min(100, parseInt(cleaned, 10)));
    setProgress(String(n));
  };

  return (
    <View className="rounded-md border border-amber-900/50 bg-amber-50/40 p-3">
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Arc name
      </Text>
      <TextInput
        value={arcName}
        onChangeText={setArcName}
        placeholder="e.g. The Iron Marathon"
        placeholderTextColor="#57534e"
        editable={!busy}
        className="mb-2 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      {onRegenerate ? (
        <Pressable
          onPress={() => void onRegenerate()}
          disabled={busy || regenerating}
          className={`mb-3 self-start rounded-md border border-amber-700 px-3 py-2 ${
            regenerating ? 'bg-amber-100/40' : 'active:bg-amber-100'
          }`}
          accessibilityRole="button"
          accessibilityLabel="Regenerate arc name"
        >
          <Text className="font-body text-base text-amber-800">
            {regenerating ? 'The Archivist ponders…' : 'Regenerate name ✶'}
          </Text>
        </Pressable>
      ) : null}
      <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
        Real-world goal
      </Text>
      <TextInput
        value={goal}
        onChangeText={setGoal}
        placeholder="e.g. Run a half-marathon by autumn"
        placeholderTextColor="#57534e"
        editable={!busy}
        multiline
        className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
      />
      {initial ? (
        <>
          <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
            Progress %
          </Text>
          <TextInput
            value={progress}
            onChangeText={onProgressChange}
            keyboardType="number-pad"
            editable={!busy}
            className="mb-3 rounded-md border border-stone-700  px-3 py-2 font-body text-stone-900"
          />
          <Text className="mb-1 font-display text-base uppercase tracking-widest text-stone-500">
            Status
          </Text>
          <View className="mb-3 flex-row gap-2">
            {(['active', 'completed', 'abandoned'] as const).map((s) => {
              const selected = status === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setStatus(s)}
                  disabled={busy}
                  className={`flex-1 rounded-md border px-2 py-2 ${
                    selected
                      ? 'border-amber-600 bg-amber-900/40'
                      : 'border-stone-800  active:bg-amber-50/40'
                  }`}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    className={`text-center font-body text-lg uppercase tracking-widest ${
                      selected ? 'text-amber-800' : 'text-stone-700'
                    }`}
                  >
                    {s}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable
          onPress={() =>
            onSave({
              arc_name: arcName,
              real_world_goal: goal,
              ...(initial
                ? {
                    progress_pct: progress === '' ? 0 : parseInt(progress, 10),
                    status,
                  }
                : {}),
            })
          }
          disabled={!canSave}
          className={`flex-1 rounded-md px-3 py-2 ${
            canSave ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'
          }`}
        >
          <Text className="text-center font-body-medium text-xl text-stone-900">
            {initial ? 'Save' : 'Create'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
        >
          <Text className="text-center font-body text-xl text-stone-700">Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            className="rounded-md border border-red-900 bg-amber-50/40 px-3 py-2 active:bg-red-950"
          >
            <Text className="text-center font-body text-xl text-red-700">Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Reanimated-driven progress bar for the level card. Drives a scaleX
 * transform rather than width, transforms are GPU-composited (no
 * layout/reflow) and Reanimated's web shim handles them more reliably
 * than percentage widths, so the sweep stays glass-smooth.
 *
 * The bar is rendered at full width (scaleX:1 = full bar) and scaled
 * down via transformOrigin:'left' so it grows from the left edge.
 *
 * On first mount the sharedValue is initialized to the target so we
 * snap to the correct starting state, no "fill from empty" sweep just
 * because the user opened the screen. Subsequent target changes (e.g.
 * after a quest completion refetches the profile) animate over 900ms.
 */
function AnimatedXpBar({ targetFraction }: { targetFraction: number }) {
  const fraction = useSharedValue(targetFraction);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      fraction.value = targetFraction;
      return;
    }
    fraction.value = withTiming(targetFraction, {
      duration: 900,
      easing: Easing.linear,
    });
  }, [targetFraction, fraction]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.0001, Math.min(1, fraction.value)) }],
  }));

  return (
    <View className="mb-1 h-2 overflow-hidden rounded-full bg-amber-100/40">
      <Animated.View
        style={[
          {
            height: 8, // matches h-2 (Tailwind 0.5rem on default 16px base)
            width: '100%',
            borderRadius: 9999, // rounded-full
            backgroundColor: '#f59e0b', // amber-500
            transformOrigin: 'left',
          },
          style,
        ]}
      />
    </View>
  );
}
