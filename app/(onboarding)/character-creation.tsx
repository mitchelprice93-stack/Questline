import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useAuth } from '../../lib/auth';
import {
  applyCharacterSheet,
  generateCharacterSheet,
  type CharacterSheetResult,
} from '../../lib/character-creation';
import { ParchmentScreen } from '../../lib/parchment';

const TOTAL_STEPS = 7;

const parseList = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export default function CharacterCreation() {
  const { session, profile, refetchProfile } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [background, setBackground] = useState('');
  const [factionsRaw, setFactionsRaw] = useState('');
  const [proficiencies, setProficiencies] = useState('');
  const [lifeSummary, setLifeSummary] = useState('');
  const [campaignsRaw, setCampaignsRaw] = useState('');
  const [inventory, setInventory] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CharacterSheetResult | null>(null);

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const sheet = await generateCharacterSheet({
        name: name.trim(),
        title: title.trim() ? title.trim() : null,
        background: background.trim(),
        factions: parseList(factionsRaw),
        proficiencies: proficiencies.trim(),
        life_summary: lifeSummary.trim(),
        campaigns: parseList(campaignsRaw),
        inventory: inventory.trim() ? inventory.trim() : null,
      });
      await applyCharacterSheet(name.trim(), sheet);
      // Refetch so the protected-route gate sees the new character_name and
      // doesn't keep us pinned at /character-creation.
      await refetchProfile();
      setRevealed(sheet);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  if (revealed) {
    return (
      <Reveal
        sheet={revealed}
        chroniclerName={name.trim()}
        onContinue={() => router.replace('/quest-board')}
      />
    );
  }

  // Anonymous user shouldn't be here, bounce.
  if (!session) return <Redirect href="/login" />;
  // Already created a character (e.g. landed on this URL by accident), bounce.
  if (profile?.character_name) return <Redirect href="/quest-board" />;

  if (submitting) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center px-6">
          <ActivityIndicator color="#92400e" size="large" />
          <Text className="mt-6 font-display text-xl text-stone-900">
            The Archivist studies your tome…
          </Text>
          {error ? (
            <Text className="mt-4 font-body text-base text-red-700">{error}</Text>
          ) : null}
        </View>
      </ParchmentScreen>
    );
  }

  const canAdvance = (() => {
    switch (step) {
      case 0:
        return name.trim().length > 0;
      case 1:
        return background.trim().length > 0;
      case 2:
        return parseList(factionsRaw).length > 0;
      case 3:
        return proficiencies.trim().length > 0;
      case 4:
        return lifeSummary.trim().length > 0;
      case 5:
        return parseList(campaignsRaw).length > 0;
      case 6:
        return true; // inventory is optional
      default:
        return false;
    }
  })();

  const next = () => {
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
    else onSubmit();
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 font-display text-xs uppercase tracking-widest text-amber-800">
        Step {step + 1} of {TOTAL_STEPS}
      </Text>
      <View className="mb-8 h-1 overflow-hidden rounded-full bg-amber-100/40">
        <View
          className="h-1 rounded-full bg-amber-500"
          style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
        />
      </View>

      {step === 0 && (
        <Step
          title="Your name"
          flavor="What shall the Tome call you? A title is optional, the Archivist may bestow one regardless."
        >
          <Field label="Name" value={name} onChange={setName} autoFocus />
          <Field
            label="Title (optional)"
            value={title}
            onChange={setTitle}
            placeholder="e.g., the Restless"
          />
        </Step>
      )}
      {step === 1 && (
        <Step
          title="Background"
          flavor="A few sentences of who you are, where you come from, what shaped you. The Archivist uses this to find your voice."
        >
          <Field label="Your story" value={background} onChange={setBackground} multiline />
        </Step>
      )}
      {step === 2 && (
        <Step
          title="Factions"
          flavor="Where do you spend your days? List your workplaces, schools, or the places that demand your attention. Comma- or newline-separated."
        >
          <Field
            label="Plain-language workplaces"
            value={factionsRaw}
            onChange={setFactionsRaw}
            multiline
            placeholder={'Axiom Space\nUT Austin'}
          />
          <Hint count={parseList(factionsRaw).length} singular="entry" />
        </Step>
      )}
      {step === 3 && (
        <Step
          title="Proficiencies"
          flavor="What you've trained in. Education, certifications, hard-won skills, anything you've put serious time into."
        >
          <Field
            label="Skills, training, education"
            value={proficiencies}
            onChange={setProficiencies}
            multiline
          />
        </Step>
      )}
      {step === 4 && (
        <Step
          title="Life summary"
          flavor="The current state of you. Energy, stress, momentum, what's heavy and what's clear. Drives where the Archivist places you on the Tome."
        >
          <Field
            label="Where you are now"
            value={lifeSummary}
            onChange={setLifeSummary}
            multiline
          />
        </Step>
      )}
      {step === 5 && (
        <Step
          title="Current campaigns"
          flavor="The long arcs you're already in motion on, projects, goals, ongoing endeavors. Plain language; the Archivist will name them. Comma- or newline-separated."
        >
          <Field
            label="Goals and ongoing projects"
            value={campaignsRaw}
            onChange={setCampaignsRaw}
            multiline
            placeholder={'Ship Questline v1\nRun a half marathon'}
          />
          <Hint count={parseList(campaignsRaw).length} singular="entry" />
        </Step>
      )}
      {step === 6 && (
        <Step
          title="Inventory"
          flavor="Optional. Anything you carry that matters, tools, gear, totems. Skip if nothing comes to mind."
        >
          <Field
            label="Items, gear, totems"
            value={inventory}
            onChange={setInventory}
            multiline
            placeholder="Skippable"
          />
        </Step>
      )}

      {error ? <Text className="mt-4 font-body text-base text-red-700">{error}</Text> : null}

      <View className="mt-8 flex-row gap-3">
        {step > 0 ? (
          <Pressable
            onPress={back}
            className="flex-1 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
          >
            <Text className="text-center font-body text-stone-700">Back</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={next}
          disabled={!canAdvance}
          className={`flex-1 rounded-md px-4 py-3 ${canAdvance ? 'bg-amber-600 active:bg-amber-700' : 'bg-amber-100/40'}`}
        >
          <Text className="text-center font-body-medium text-stone-900">
            {step === TOTAL_STEPS - 1 ? 'Forge character' : 'Next'}
          </Text>
        </Pressable>
      </View>
      </ScrollView>
    </ParchmentScreen>
  );
}

function Step({
  title,
  flavor,
  children,
}: {
  title: string;
  flavor: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text className="mb-2 font-display text-3xl text-stone-900">{title}</Text>
      <Text className="mb-6 font-body text-lg text-stone-700">{flavor}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <View className="mb-4">
      <Text className="mb-2 font-body text-base text-stone-700">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor="#a8a29e"
        textAlignVertical={multiline ? 'top' : 'auto'}
        className={`rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 font-body text-stone-900 ${
          multiline ? 'min-h-[112px]' : ''
        }`}
      />
    </View>
  );
}

function Hint({ count, singular }: { count: number; singular: string }) {
  if (count === 0) return null;
  return (
    <Text className="font-body text-sm text-stone-600">
      {count} {singular}
      {count === 1 ? '' : 's'} parsed
    </Text>
  );
}

// Phase 3.5, sequenced reveal with staggered fade-in for each section.
// Each Animated.View enters 200ms after the previous, so the chronicle unfolds
// rather than appearing all at once.
function Reveal({
  sheet,
  chroniclerName,
  onContinue,
}: {
  sheet: CharacterSheetResult;
  chroniclerName: string;
  onContinue: () => void;
}) {
  const D = 800; // duration per section
  const stagger = (n: number) => FadeInDown.delay(n * 200).duration(D);

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-16 pb-12">
      <Animated.View entering={stagger(0)}>
        <Text className="mb-1 font-display text-xs uppercase tracking-widest text-amber-800">
          The Tome opens
        </Text>
      </Animated.View>

      <Animated.View entering={stagger(1)}>
        <Text className="mb-1 font-display text-3xl text-stone-900">{chroniclerName}</Text>
      </Animated.View>

      <Animated.View entering={stagger(2)}>
        <Text className="mb-2 font-display text-xl text-amber-800">{sheet.character_title}</Text>
      </Animated.View>

      <Animated.View entering={stagger(3)}>
        <Text className="mb-8 font-body text-lg text-stone-600">
          Inscribed at Level {sheet.starting_level}
          {sheet.fromFallback ? ' · templated (the Archivist was silent)' : ''}
        </Text>
      </Animated.View>

      {sheet.factions.length > 0 ? (
        <Animated.View entering={stagger(4)}>
          <View className="mb-6">
            <Text className="mb-2 font-body text-base text-stone-700">Factions</Text>
            <View className="gap-2">
              {sheet.factions.map((f, i) => (
                <View key={i} className="rounded-md border border-stone-700 bg-amber-50/40 p-4">
                  <Text className="font-body-medium text-lg text-stone-900">{f.name}</Text>
                  <Text className="font-body text-sm text-stone-600">{f.real_world_domain}</Text>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>
      ) : null}

      {sheet.campaigns.length > 0 ? (
        <Animated.View entering={stagger(5)}>
          <View className="mb-6">
            <Text className="mb-2 font-body text-base text-stone-700">Campaigns</Text>
            <View className="gap-2">
              {sheet.campaigns.map((c, i) => (
                <View key={i} className="rounded-md border border-stone-700 bg-amber-50/40 p-4">
                  <Text className="font-body-medium text-lg text-stone-900">{c.arc_name}</Text>
                  <Text className="font-body text-sm text-stone-600">{c.real_world_goal}</Text>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>
      ) : null}

      <Animated.View entering={stagger(6)}>
        <View className="mb-8 rounded-md border border-amber-900/40 bg-amber-100/40 p-4">
          <Text className="mb-1 font-display text-xs uppercase tracking-widest text-amber-800">
            First quest hook
          </Text>
          <Text className="font-body text-lg text-stone-800">{sheet.first_quest_hook}</Text>
        </View>
      </Animated.View>

      <Animated.View entering={stagger(7)}>
        <Pressable
          onPress={onContinue}
          className="rounded-md bg-amber-600 px-4 py-3 active:bg-amber-700"
        >
          <Text className="text-center font-display text-base text-stone-900">
            Begin your chronicle
          </Text>
        </Pressable>
      </Animated.View>
      </ScrollView>
    </ParchmentScreen>
  );
}
