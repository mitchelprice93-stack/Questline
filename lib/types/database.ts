export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_call_log: {
        Row: {
          cost_usd: number | null
          created_at: string
          endpoint: string | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          user_id: string
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          endpoint?: string | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          user_id: string
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          endpoint?: string | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          arc_name: string
          created_at: string
          faction_id: string | null
          id: string
          progress_pct: number
          real_world_goal: string
          status: string
          user_id: string
        }
        Insert: {
          arc_name: string
          created_at?: string
          faction_id?: string | null
          id?: string
          progress_pct?: number
          real_world_goal: string
          status?: string
          user_id: string
        }
        Update: {
          arc_name?: string
          created_at?: string
          faction_id?: string | null
          id?: string
          progress_pct?: number
          real_world_goal?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      factions: {
        Row: {
          created_at: string
          id: string
          name: string
          real_world_domain: string
          reputation_count: number
          reputation_title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          real_world_domain: string
          reputation_count?: number
          reputation_title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          real_world_domain?: string
          reputation_count?: number
          reputation_title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "factions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          consumed_at: string | null
          created_at: string
          effect_description: string | null
          expires_at: string | null
          id: string
          name: string
          notified_at: string | null
          quest_id: string | null
          source_kind: string | null
          type: string
          user_id: string
          xp_modifier_pct: number
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          effect_description?: string | null
          expires_at?: string | null
          id?: string
          name: string
          notified_at?: string | null
          quest_id?: string | null
          source_kind?: string | null
          type: string
          user_id: string
          xp_modifier_pct?: number
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          effect_description?: string | null
          expires_at?: string | null
          id?: string
          name?: string
          notified_at?: string | null
          quest_id?: string | null
          source_kind?: string | null
          type?: string
          user_id?: string
          xp_modifier_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifiers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          character_name: string | null
          character_title: string | null
          created_at: string
          difficulty: string
          display_name: string | null
          id: string
          last_rest_at: string | null
          level: number
          total_xp: number
        }
        Insert: {
          character_name?: string | null
          character_title?: string | null
          created_at?: string
          difficulty?: string
          display_name?: string | null
          id: string
          last_rest_at?: string | null
          level?: number
          total_xp?: number
        }
        Update: {
          character_name?: string | null
          character_title?: string | null
          created_at?: string
          difficulty?: string
          display_name?: string | null
          id?: string
          last_rest_at?: string | null
          level?: number
          total_xp?: number
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          expo_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          expo_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          expo_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quests: {
        Row: {
          abandoned_at: string | null
          campaign_id: string | null
          classification: string
          completed_at: string | null
          created_at: string
          deadline: string | null
          deadline_warning_sent_at: string | null
          description: string | null
          faction_id: string | null
          granted_buff_condition: string | null
          granted_buff_description: string | null
          granted_buff_name: string | null
          granted_buff_pct: number | null
          id: string
          last_completed_at: string | null
          objectives: Json
          recurrence: string | null
          status: string
          streak_count: number
          tier: string
          title: string
          user_id: string
          xp_reward: number
        }
        Insert: {
          abandoned_at?: string | null
          campaign_id?: string | null
          classification: string
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          deadline_warning_sent_at?: string | null
          description?: string | null
          faction_id?: string | null
          granted_buff_condition?: string | null
          granted_buff_description?: string | null
          granted_buff_name?: string | null
          granted_buff_pct?: number | null
          id?: string
          last_completed_at?: string | null
          objectives?: Json
          recurrence?: string | null
          status?: string
          streak_count?: number
          tier: string
          title: string
          user_id: string
          xp_reward: number
        }
        Update: {
          abandoned_at?: string | null
          campaign_id?: string | null
          classification?: string
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          deadline_warning_sent_at?: string | null
          description?: string | null
          faction_id?: string | null
          granted_buff_condition?: string | null
          granted_buff_description?: string | null
          granted_buff_name?: string | null
          granted_buff_pct?: number | null
          id?: string
          last_completed_at?: string | null
          objectives?: Json
          recurrence?: string | null
          status?: string
          streak_count?: number
          tier?: string
          title?: string
          user_id?: string
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "quests_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          expires_at: string | null
          rc_customer_id: string | null
          status: string | null
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          rc_customer_id?: string | null
          status?: string | null
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          rc_customer_id?: string | null
          status?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_log: {
        Row: {
          created_at: string
          id: string
          quest_id: string | null
          reason: string
          user_id: string
          xp_change: number
        }
        Insert: {
          created_at?: string
          id?: string
          quest_id?: string | null
          reason: string
          user_id: string
          xp_change: number
        }
        Update: {
          created_at?: string
          id?: string
          quest_id?: string | null
          reason?: string
          user_id?: string
          xp_change?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_log_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_quest: { Args: { quest_id: string }; Returns: undefined }
      apply_character_creation: {
        Args: {
          p_campaigns: Json
          p_character_name: string
          p_character_title: string
          p_factions: Json
          p_starting_level: number
          p_total_xp: number
        }
        Returns: undefined
      }
      buff_duration_for_tier: { Args: { p_tier: string }; Returns: string }
      complete_quest: {
        Args: { quest_id: string }
        Returns: {
          buff_granted: string
          milestone_bonus: number
          net_modifier_pct: number
          new_streak: number
          new_total_xp: number
          xp_change: number
        }[]
      }
      cron_refresh_all_debuffs: { Args: never; Returns: number }
      notify_approaching_deadlines: {
        Args: { p_user_id: string }
        Returns: number
      }
      notify_user_of_debuffs: { Args: { p_user_id: string }; Returns: number }
      refresh_debuffs_for: { Args: { p_user_id: string }; Returns: undefined }
      refresh_debuffs_for_user: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      reset_character: { Args: never; Returns: undefined }
      rest_user: {
        Args: never
        Returns: {
          cleared_count: number
          next_rest_available_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
