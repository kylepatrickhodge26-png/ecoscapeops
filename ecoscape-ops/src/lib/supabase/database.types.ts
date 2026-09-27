export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      business_members: {
        Row: {
          business_id: string
          created_at: string
          role: Database["public"]["Enums"]["business_role"]
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          role: Database["public"]["Enums"]["business_role"]
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["business_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          created_at: string
          id: string
          name: string
          time_zone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          time_zone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
      }
      crew_members: {
        Row: {
          business_id: string
          created_at: string
          email: string | null
          id: string
          invite_expires_at: string | null
          invite_token_hash: string | null
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          invite_expires_at?: string | null
          invite_token_hash?: string | null
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          invite_expires_at?: string | null
          invite_token_hash?: string | null
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_business_id_user_id_fkey"
            columns: ["business_id", "user_id"]
            isOneToOne: false
            referencedRelation: "business_members"
            referencedColumns: ["business_id", "user_id"]
          },
        ]
      }
      customers: {
        Row: {
          access_instructions: string
          billing_address: string
          business_id: string
          created_at: string
          customer_since: string
          email: string
          first_name: string
          id: string
          last_name: string
          notification_preference: string
          phone: string
          phone_digits: string | null
          preferred_day: string
          property_address: string
          service_notes: string
          sms_opt_in: boolean
          status: string
          updated_at: string
        }
        Insert: {
          access_instructions?: string
          billing_address?: string
          business_id: string
          created_at?: string
          customer_since?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notification_preference?: string
          phone?: string
          phone_digits?: string | null
          preferred_day?: string
          property_address?: string
          service_notes?: string
          sms_opt_in?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          access_instructions?: string
          billing_address?: string
          business_id?: string
          created_at?: string
          customer_since?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notification_preference?: string
          phone?: string
          phone_digits?: string | null
          preferred_day?: string
          property_address?: string
          service_notes?: string
          sms_opt_in?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          business_id: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          id: string
          notes: string
          spent_on: string
          updated_at: string
          vendor: string
        }
        Insert: {
          amount: number
          business_id: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          spent_on: string
          updated_at?: string
          vendor?: string
        }
        Update: {
          amount?: number
          business_id?: string
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          spent_on?: string
          updated_at?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          assigned_crew_member_id: string | null
          business_id: string
          completed_at: string | null
          created_at: string
          customer_id: string
          id: string
          notes: string
          price: number
          scheduled_date: string
          service_name: string
          service_plan_id: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          assigned_crew_member_id?: string | null
          business_id: string
          completed_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          notes?: string
          price: number
          scheduled_date: string
          service_name: string
          service_plan_id: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          assigned_crew_member_id?: string | null
          business_id?: string
          completed_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string
          price?: number
          scheduled_date?: string
          service_name?: string
          service_plan_id?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_crew_member_fkey"
            columns: ["assigned_crew_member_id", "business_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_customer_id_business_id_fkey"
            columns: ["customer_id", "business_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "jobs_service_plan_id_business_id_fkey"
            columns: ["service_plan_id", "business_id"]
            isOneToOne: false
            referencedRelation: "service_plans"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      rain_delay_visits: {
        Row: {
          business_id: string
          job_id: string
          rain_delay_id: string
        }
        Insert: {
          business_id: string
          job_id: string
          rain_delay_id: string
        }
        Update: {
          business_id?: string
          job_id?: string
          rain_delay_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rain_delay_visits_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rain_delay_visits_job_id_business_id_fkey"
            columns: ["job_id", "business_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "rain_delay_visits_rain_delay_id_business_id_fkey"
            columns: ["rain_delay_id", "business_id"]
            isOneToOne: false
            referencedRelation: "rain_delays"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      rain_delays: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          from_date: string
          id: string
          to_date: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          from_date: string
          id?: string
          to_date: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          from_date?: string
          id?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "rain_delays_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          business_id: string
          created_at: string
          latitude: number
          longitude: number
          place_name: string
          postal_code: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          latitude: number
          longitude: number
          place_name: string
          postal_code: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          latitude?: number
          longitude?: number
          place_name?: string
          postal_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      service_plans: {
        Row: {
          active: boolean
          assigned_crew_member_id: string | null
          business_id: string
          created_at: string
          customer_id: string
          frequency: Database["public"]["Enums"]["service_frequency"]
          id: string
          next_visit_date: string | null
          price: number
          service_name: string
          start_date: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          assigned_crew_member_id?: string | null
          business_id: string
          created_at?: string
          customer_id: string
          frequency: Database["public"]["Enums"]["service_frequency"]
          id?: string
          next_visit_date?: string | null
          price: number
          service_name: string
          start_date: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          assigned_crew_member_id?: string | null
          business_id?: string
          created_at?: string
          customer_id?: string
          frequency?: Database["public"]["Enums"]["service_frequency"]
          id?: string
          next_visit_date?: string | null
          price?: number
          service_name?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_plans_assigned_crew_member_fkey"
            columns: ["assigned_crew_member_id", "business_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "service_plans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_plans_customer_id_business_id_fkey"
            columns: ["customer_id", "business_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          body: string
          business_id: string
          created_at: string
          customer_id: string | null
          error_code: number | null
          error_message: string | null
          from_phone: string
          id: string
          rain_delay_id: string
          sent_by: string | null
          status: Database["public"]["Enums"]["sms_status"]
          to_phone: string
          twilio_sid: string | null
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          created_at?: string
          customer_id?: string | null
          error_code?: number | null
          error_message?: string | null
          from_phone: string
          id?: string
          rain_delay_id: string
          sent_by?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          to_phone: string
          twilio_sid?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          created_at?: string
          customer_id?: string | null
          error_code?: number | null
          error_message?: string | null
          from_phone?: string
          id?: string
          rain_delay_id?: string
          sent_by?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          to_phone?: string
          twilio_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_customer_id_business_id_fkey"
            columns: ["customer_id", "business_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "sms_messages_rain_delay_id_business_id_fkey"
            columns: ["rain_delay_id", "business_id"]
            isOneToOne: false
            referencedRelation: "rain_delays"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      sms_senders: {
        Row: {
          business_id: string
          created_at: string
          phone_number: string
        }
        Insert: {
          business_id: string
          created_at?: string
          phone_number: string
        }
        Update: {
          business_id?: string
          created_at?: string
          phone_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_senders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_crew_invite: { Args: { token: string }; Returns: string }
      add_crew_member: {
        Args: { member_name: string }
        Returns: {
          crew_member_id: string
          invite_token: string
        }[]
      }
      business_service_area: {
        Args: never
        Returns: {
          latitude: number
          longitude: number
          place_name: string
          postal_code: string
        }[]
      }
      create_business: {
        Args: { business_name: string; time_zone?: string }
        Returns: string
      }
      crew_add_job_note: {
        Args: { job_id: string; note: string }
        Returns: undefined
      }
      crew_could_not_service: {
        Args: {
          choice: string
          job_id: string
          new_date: string
          note_line: string
        }
        Returns: undefined
      }
      crew_invite_details: {
        Args: { token: string }
        Returns: {
          business_name: string
          crew_member_name: string
        }[]
      }
      crew_jobs: {
        Args: { from_date: string; to_date: string }
        Returns: {
          access_instructions: string
          customer_email: string
          customer_first_name: string
          customer_last_name: string
          customer_phone: string
          id: string
          notes: string
          property_address: string
          scheduled_date: string
          service_name: string
          service_notes: string
          status: Database["public"]["Enums"]["job_status"]
        }[]
      }
      crew_set_job_status: {
        Args: {
          job_id: string
          new_status: Database["public"]["Enums"]["job_status"]
        }
        Returns: undefined
      }
      dashboard_summary: {
        Args: never
        Returns: {
          month_booked: number
          month_completed: number
          month_expenses: number
          today: string
          today_completed: number
          today_total: number
          tomorrow_total: number
          week_total: number
        }[]
      }
      move_day_visits: {
        Args: { from_date: string; to_date: string }
        Returns: string
      }
      rain_delay_texts: {
        Args: { rain_delay_id: string }
        Returns: {
          body: string
          can_text: boolean
          customer_id: string
          error_code: number
          error_message: string
          first_name: string
          last_name: string
          message_id: string
          phone: string
          reason: string
          sent_at: string
          status: Database["public"]["Enums"]["sms_status"]
          to_phone: string
        }[]
      }
      record_sms_result: {
        Args: {
          error_code?: number
          error_message?: string
          message_id: string
          twilio_sid?: string
          twilio_status?: string
        }
        Returns: undefined
      }
      regenerate_crew_invite: {
        Args: { crew_member_id: string }
        Returns: string
      }
      remove_crew_member: {
        Args: { crew_member_id: string }
        Returns: undefined
      }
      start_rain_delay_texts: {
        Args: { rain_delay_id: string }
        Returns: {
          body: string
          from_phone: string
          message_id: string
          to_phone: string
        }[]
      }
      stop_service_plan: { Args: { plan_id: string }; Returns: number }
      twilio_message_status: {
        Args: {
          error_code?: number
          message_sid: string
          message_status: string
        }
        Returns: undefined
      }
      twilio_opt_out: {
        Args: { from_number: string; to_number: string }
        Returns: number
      }
    }
    Enums: {
      business_role: "owner" | "crew"
      expense_category:
        | "fuel"
        | "equipment"
        | "repairs"
        | "materials"
        | "fertilizer"
        | "mulch"
        | "payroll"
        | "insurance"
        | "advertising"
        | "vehicle"
        | "other"
      job_status:
        | "scheduled"
        | "assigned"
        | "en_route"
        | "in_progress"
        | "completed"
        | "unable_to_complete"
        | "weather_delay"
        | "cancelled"
      service_frequency: "weekly" | "biweekly" | "triweekly" | "one_time"
      sms_status:
        | "sending"
        | "queued"
        | "sent"
        | "delivered"
        | "undelivered"
        | "failed"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      business_role: ["owner", "crew"],
      expense_category: [
        "fuel",
        "equipment",
        "repairs",
        "materials",
        "fertilizer",
        "mulch",
        "payroll",
        "insurance",
        "advertising",
        "vehicle",
        "other",
      ],
      job_status: [
        "scheduled",
        "assigned",
        "en_route",
        "in_progress",
        "completed",
        "unable_to_complete",
        "weather_delay",
        "cancelled",
      ],
      service_frequency: ["weekly", "biweekly", "triweekly", "one_time"],
      sms_status: [
        "sending",
        "queued",
        "sent",
        "delivered",
        "undelivered",
        "failed",
      ],
    },
  },
} as const

