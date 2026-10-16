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
          bill_monthly: boolean
          business_id: string
          created_at: string
          customer_since: string
          email: string
          first_name: string
          geo_distance_miles: number | null
          geo_lat: number | null
          geo_lon: number | null
          geo_matched_address: string | null
          geo_status: Database["public"]["Enums"]["geo_status"]
          geocoded_at: string | null
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
          bill_monthly?: boolean
          business_id: string
          created_at?: string
          customer_since?: string
          email?: string
          first_name?: string
          geo_distance_miles?: number | null
          geo_lat?: number | null
          geo_lon?: number | null
          geo_matched_address?: string | null
          geo_status?: Database["public"]["Enums"]["geo_status"]
          geocoded_at?: string | null
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
          bill_monthly?: boolean
          business_id?: string
          created_at?: string
          customer_since?: string
          email?: string
          first_name?: string
          geo_distance_miles?: number | null
          geo_lat?: number | null
          geo_lon?: number | null
          geo_matched_address?: string | null
          geo_status?: Database["public"]["Enums"]["geo_status"]
          geocoded_at?: string | null
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
      invoice_lines: {
        Row: {
          amount: number | null
          business_id: string
          description: string
          id: string
          invoice_cancelled: boolean
          invoice_id: string
          job_id: string | null
          position: number
          quantity: number
          unit_price: number
        }
        Insert: {
          amount?: number | null
          business_id: string
          description: string
          id?: string
          invoice_cancelled?: boolean
          invoice_id: string
          job_id?: string | null
          position?: number
          quantity?: number
          unit_price: number
        }
        Update: {
          amount?: number | null
          business_id?: string
          description?: string
          id?: string
          invoice_cancelled?: boolean
          invoice_id?: string
          job_id?: string | null
          position?: number
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_business_id_fkey"
            columns: ["invoice_id", "business_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "invoice_lines_job_id_business_id_fkey"
            columns: ["job_id", "business_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      invoice_settings: {
        Row: {
          auto_invoice: boolean
          business_id: string
          cash_app: string | null
          next_number: number
          pay_link: string | null
          payment_note: string
          paypal: string | null
          updated_at: string
          venmo: string | null
          zelle: string | null
        }
        Insert: {
          auto_invoice?: boolean
          business_id: string
          cash_app?: string | null
          next_number?: number
          pay_link?: string | null
          payment_note?: string
          paypal?: string | null
          updated_at?: string
          venmo?: string | null
          zelle?: string | null
        }
        Update: {
          auto_invoice?: boolean
          business_id?: string
          cash_app?: string | null
          next_number?: number
          pay_link?: string | null
          payment_note?: string
          paypal?: string | null
          updated_at?: string
          venmo?: string | null
          zelle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          billing_month: string | null
          business_id: string
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string
          id: string
          issue_date: string
          notes: string
          number: number
          pay_token: string
          sent_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          total: number
          updated_at: string
          balance: number | null
          display_status: string | null
        }
        Insert: {
          amount_paid?: number
          billing_month?: string | null
          business_id: string
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          due_date: string
          id?: string
          issue_date: string
          notes?: string
          number: number
          pay_token?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          billing_month?: string | null
          business_id?: string
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          due_date?: string
          id?: string
          issue_date?: string
          notes?: string
          number?: number
          pay_token?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_business_id_fkey"
            columns: ["customer_id", "business_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          business_id: string
          id: string
          label: string
          position: number
          template_id: string
        }
        Insert: {
          business_id: string
          id?: string
          label: string
          position: number
          template_id: string
        }
        Update: {
          business_id?: string
          id?: string
          label?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_template_items_template_id_business_id_fkey"
            columns: ["template_id", "business_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          business_id: string
          created_at: string
          id: string
          service_name: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          service_name: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          service_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      job_checklist_items: {
        Row: {
          business_id: string
          done: boolean
          done_at: string | null
          done_by: string | null
          done_by_name: string
          id: string
          job_id: string
          label: string
          position: number
        }
        Insert: {
          business_id: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          done_by_name?: string
          id?: string
          job_id: string
          label: string
          position: number
        }
        Update: {
          business_id?: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          done_by_name?: string
          id?: string
          job_id?: string
          label?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_checklist_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_checklist_items_job_id_business_id_fkey"
            columns: ["job_id", "business_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      job_photos: {
        Row: {
          business_id: string
          caption: string
          created_at: string
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          uploaded_by_name: string
        }
        Insert: {
          business_id: string
          caption?: string
          created_at?: string
          id?: string
          job_id: string
          kind?: Database["public"]["Enums"]["photo_kind"]
          size_bytes?: number
          storage_path: string
          uploaded_by?: string | null
          uploaded_by_name?: string
        }
        Update: {
          business_id?: string
          caption?: string
          created_at?: string
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["photo_kind"]
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          uploaded_by_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_job_id_business_id_fkey"
            columns: ["job_id", "business_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "business_id"]
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
      payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string
          received_on: string
          recorded_by: string | null
          request_id: string
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string
          received_on: string
          recorded_by?: string | null
          request_id: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string
          received_on?: string
          recorded_by?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_business_id_fkey"
            columns: ["invoice_id", "business_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      quote_counters: {
        Row: {
          business_id: string
          next_number: number
        }
        Insert: {
          business_id: string
          next_number?: number
        }
        Update: {
          business_id?: string
          next_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_lines: {
        Row: {
          amount: number | null
          business_id: string
          description: string
          id: string
          position: number
          quantity: number
          quote_id: string
          unit_price: number
        }
        Insert: {
          amount?: number | null
          business_id: string
          description: string
          id?: string
          position?: number
          quantity?: number
          quote_id: string
          unit_price: number
        }
        Update: {
          amount?: number | null
          business_id?: string
          description?: string
          id?: string
          position?: number
          quantity?: number
          quote_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_lines_quote_id_business_id_fkey"
            columns: ["quote_id", "business_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_service_plan_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          decided_at: string | null
          expires_on: string
          id: string
          issue_date: string
          notes: string
          number: number
          prospect_address: string
          prospect_email: string
          prospect_name: string
          prospect_phone: string
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          title: string
          total: number
          updated_at: string
          quote_status_shown: string | null
        }
        Insert: {
          accepted_service_plan_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          decided_at?: string | null
          expires_on: string
          id?: string
          issue_date: string
          notes?: string
          number: number
          prospect_address?: string
          prospect_email?: string
          prospect_name?: string
          prospect_phone?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          title?: string
          total?: number
          updated_at?: string
        }
        Update: {
          accepted_service_plan_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          decided_at?: string | null
          expires_on?: string
          id?: string
          issue_date?: string
          notes?: string
          number?: number
          prospect_address?: string
          prospect_email?: string
          prospect_name?: string
          prospect_phone?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          title?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_business_id_fkey"
            columns: ["customer_id", "business_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "quotes_accepted_service_plan_id_business_id_fkey"
            columns: ["accepted_service_plan_id", "business_id"]
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
      route_days: {
        Row: {
          business_id: string
          crew_member_id: string | null
          id: string
          manual_order: string[] | null
          route_date: string
          start_address: string | null
          start_lat: number | null
          start_lon: number | null
          start_matched_address: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_id: string
          crew_member_id?: string | null
          id?: string
          manual_order?: string[] | null
          route_date: string
          start_address?: string | null
          start_lat?: number | null
          start_lon?: number | null
          start_matched_address?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_id?: string
          crew_member_id?: string | null
          id?: string
          manual_order?: string[] | null
          route_date?: string
          start_address?: string | null
          start_lat?: number | null
          start_lon?: number | null
          start_matched_address?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "route_days_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_days_crew_member_id_business_id_fkey"
            columns: ["crew_member_id", "business_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id", "business_id"]
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
      request_links: {
        Row: {
          business_id: string
          enabled: boolean
          token: string
          updated_at: string
        }
        Insert: {
          business_id: string
          enabled?: boolean
          token?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          enabled?: boolean
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          address: string
          business_id: string
          created_at: string
          customer_id: string | null
          details: string
          email: string
          handled_at: string | null
          id: string
          ip_hash: string
          name: string
          phone: string
          status: Database["public"]["Enums"]["request_status"]
        }
        Insert: {
          address?: string
          business_id: string
          created_at?: string
          customer_id?: string | null
          details: string
          email?: string
          handled_at?: string | null
          id?: string
          ip_hash: string
          name: string
          phone?: string
          status?: Database["public"]["Enums"]["request_status"]
        }
        Update: {
          address?: string
          business_id?: string
          created_at?: string
          customer_id?: string | null
          details?: string
          email?: string
          handled_at?: string | null
          id?: string
          ip_hash?: string
          name?: string
          phone?: string
          status?: Database["public"]["Enums"]["request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
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
      shop_locations: {
        Row: {
          address: string
          business_id: string
          city: string
          lat: number
          lon: number
          matched_address: string
          postal_code: string
          state: string
          updated_at: string
        }
        Insert: {
          address: string
          business_id: string
          city: string
          lat: number
          lon: number
          matched_address: string
          postal_code?: string
          state: string
          updated_at?: string
        }
        Update: {
          address?: string
          business_id?: string
          city?: string
          lat?: number
          lon?: number
          matched_address?: string
          postal_code?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          business_id: string
          created_at: string
          crew_member_id: string | null
          crew_name: string
          edited_at: string | null
          ended_at: string | null
          id: string
          job_id: string
          note: string
          started_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          crew_member_id?: string | null
          crew_name: string
          edited_at?: string | null
          ended_at?: string | null
          id?: string
          job_id: string
          note?: string
          started_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          crew_member_id?: string | null
          crew_name?: string
          edited_at?: string | null
          ended_at?: string | null
          id?: string
          job_id?: string
          note?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_job_id_business_id_fkey"
            columns: ["job_id", "business_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      weather_texts: {
        Row: {
          business_id: string
          customer_id: string
          opened_at: string
          opened_by: string | null
          rain_delay_id: string
        }
        Insert: {
          business_id: string
          customer_id: string
          opened_at?: string
          opened_by?: string | null
          rain_delay_id: string
        }
        Update: {
          business_id?: string
          customer_id?: string
          opened_at?: string
          opened_by?: string | null
          rain_delay_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weather_texts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_texts_customer_id_business_id_fkey"
            columns: ["customer_id", "business_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "weather_texts_rain_delay_id_business_id_fkey"
            columns: ["rain_delay_id", "business_id"]
            isOneToOne: false
            referencedRelation: "rain_delays"
            referencedColumns: ["id", "business_id"]
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
      balance: {
        Args: { "": Database["public"]["Tables"]["invoices"]["Row"] }
        Returns: {
          error: true
        } & "the function public.balance with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
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
      cancel_invoice: { Args: { invoice_id: string }; Returns: undefined }
      change_invoice_due_date: {
        Args: { due_date: string; invoice_id: string }
        Returns: undefined
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
      crew_route: {
        Args: { route_date: string }
        Returns: {
          access_instructions: string
          customer_email: string
          customer_first_name: string
          customer_last_name: string
          customer_phone: string
          geo_lat: number
          geo_lon: number
          geo_status: Database["public"]["Enums"]["geo_status"]
          id: string
          notes: string
          property_address: string
          scheduled_date: string
          service_name: string
          service_notes: string
          status: Database["public"]["Enums"]["job_status"]
        }[]
      }
      crew_route_settings: {
        Args: { route_date: string }
        Returns: {
          crew_member_id: string
          manual_order: string[]
          shop_address: string
          shop_city: string
          shop_lat: number
          shop_lon: number
          shop_state: string
          start_address: string
          start_lat: number
          start_lon: number
          start_matched_address: string
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
          month_collected: number
          month_completed: number
          month_expenses: number
          outstanding: number
          overdue: number
          today: string
          today_completed: number
          today_total: number
          tomorrow_total: number
          week_total: number
        }[]
      }
      delete_draft_invoice: { Args: { invoice_id: string }; Returns: undefined }
      delete_manual_payment: {
        Args: { payment_id: string }
        Returns: undefined
      }
      display_status: {
        Args: { "": Database["public"]["Tables"]["invoices"]["Row"] }
        Returns: {
          error: true
        } & "the function public.display_status with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      mark_weather_text_opened: {
        Args: { customer_id: string; rain_delay_id: string }
        Returns: string
      }
      move_day_visits: {
        Args: { from_date: string; to_date: string }
        Returns: string
      }
      public_invoice: {
        Args: { token: string }
        Returns: {
          amount_paid: number
          balance: number
          business_name: string
          cash_app: string
          customer_name: string
          due_date: string
          issue_date: string
          lines: Json
          number: number
          pay_link: string
          payment_note: string
          paypal: string
          status: string
          total: number
          venmo: string
          zelle: string
        }[]
      }
      rain_delay_texts: {
        Args: { rain_delay_id: string }
        Returns: {
          body: string
          can_text: boolean
          customer_id: string
          first_name: string
          last_name: string
          opened_at: string
          phone: string
          reason: string
          to_phone: string
        }[]
      }
      record_customer_geocode: {
        Args: {
          address: string
          customer_id: string
          distance_miles: number
          lat: number
          lon: number
          matched_address: string
          status: Database["public"]["Enums"]["geo_status"]
        }
        Returns: boolean
      }
      record_manual_payment: {
        Args: {
          amount: number
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string
          received_on: string
          request_id: string
        }
        Returns: string
      }
      regenerate_crew_invite: {
        Args: { crew_member_id: string }
        Returns: string
      }
      remove_crew_member: {
        Args: { crew_member_id: string }
        Returns: undefined
      }
      add_job_photo: {
        Args: {
          caption: string
          job_id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          storage_path: string
        }
        Returns: string
      }
      delete_job_photo: { Args: { photo_id: string }; Returns: string }
      job_checklist: {
        Args: { job_id: string }
        Returns: {
          done: boolean
          done_at: string
          done_by_name: string
          id: string
          label: string
          position: number
        }[]
      }
      job_photos_for: {
        Args: { job_id: string }
        Returns: {
          caption: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          storage_path: string
          uploaded_by_name: string
        }[]
      }
      photo_usage: {
        Args: never
        Returns: {
          photo_count: number
          total_bytes: number
        }[]
      }
      report_expenses_by_category: {
        Args: { from_date: string; to_date: string }
        Returns: {
          category: Database["public"]["Enums"]["expense_category"]
          total: number
        }[]
      }
      report_jobs_by_crew: {
        Args: { from_date: string; to_date: string }
        Returns: {
          completed: number
          crew_member_id: string
          crew_name: string
          scheduled: number
        }[]
      }
      report_revenue_by_customer: {
        Args: { from_date: string; to_date: string }
        Returns: {
          booked: number
          completed: number
          customer_id: string
          customer_name: string
        }[]
      }
      report_revenue_by_month: {
        Args: { from_date: string; to_date: string }
        Returns: {
          booked: number
          completed: number
          month: string
        }[]
      }
      report_revenue_by_service: {
        Args: { from_date: string; to_date: string }
        Returns: {
          booked: number
          completed: number
          service_name: string
        }[]
      }
      report_summary: {
        Args: { from_date: string; to_date: string }
        Returns: {
          booked: number
          collected: number
          completed: number
          expenses: number
          outstanding: number
          overdue: number
        }[]
      }
      convert_request: {
        Args: { request_id: string }
        Returns: string
      }
      delete_request: {
        Args: { request_id: string }
        Returns: undefined
      }
      dismiss_request: {
        Args: { request_id: string }
        Returns: undefined
      }
      public_request_form: {
        Args: { token: string }
        Returns: {
          business_name: string
        }[]
      }
      regenerate_request_link: {
        Args: never
        Returns: string
      }
      request_link: {
        Args: never
        Returns: {
          enabled: boolean
          token: string
        }[]
      }
      set_request_link_enabled: {
        Args: { enabled: boolean }
        Returns: undefined
      }
      submit_request: {
        Args: {
          address: string
          details: string
          email: string
          ip_hash: string
          name: string
          phone: string
          token: string
        }
        Returns: undefined
      }
      generate_monthly_invoices: {
        Args: { for_month: string }
        Returns: {
          added_to_existing: boolean
          amount: number
          customer_id: string
          invoice_id: string
          visits: number
        }[]
      }
      set_customer_bill_monthly: {
        Args: { customer_id: string; enabled: boolean }
        Returns: undefined
      }
      clock_in: {
        Args: { job_id: string }
        Returns: string
      }
      clock_out: {
        Args: { job_id: string }
        Returns: undefined
      }
      delete_time_entry: {
        Args: { entry_id: string }
        Returns: undefined
      }
      edit_time_entry: {
        Args: { ended_local: string; entry_id: string; note: string; started_local: string }
        Returns: undefined
      }
      my_open_time_entry: {
        Args: never
        Returns: {
          job_id: string
          service_name: string
          started_at: string
        }[]
      }
      time_by_crew: {
        Args: { from_date: string; to_date: string }
        Returns: {
          crew_member_id: string
          crew_name: string
          entries: number
          hours: number
          open_entries: number
        }[]
      }
      time_by_customer: {
        Args: { from_date: string; to_date: string }
        Returns: {
          customer_id: string
          customer_name: string
          hours: number
          job_value: number
          revenue_per_hour: number | null
          visits: number
        }[]
      }
      time_by_job: {
        Args: { from_date: string; to_date: string }
        Returns: {
          customer_id: string
          customer_name: string
          hours: number
          job_id: string
          job_value: number
          open_entries: number
          revenue_per_hour: number | null
          scheduled_date: string
          service_name: string
        }[]
      }
      save_checklist_template: {
        Args: { items: Json; service_name: string }
        Returns: string
      }
      set_checklist_item: {
        Args: { done: boolean; item_id: string }
        Returns: undefined
      }
      accept_quote: {
        Args: {
          assigned_crew_member_id?: string
          first_visit: string
          frequency: Database["public"]["Enums"]["service_frequency"]
          quote_id: string
          service_name: string
        }
        Returns: string
      }
      decline_quote: { Args: { quote_id: string }; Returns: undefined }
      delete_draft_quote: { Args: { quote_id: string }; Returns: undefined }
      duplicate_quote: { Args: { quote_id: string }; Returns: string }
      save_quote: {
        Args: {
          customer_id: string
          expires_on: string
          lines: Json
          notes: string
          prospect_address: string
          prospect_email: string
          prospect_name: string
          prospect_phone: string
          quote_id: string
          title: string
        }
        Returns: string
      }
      send_quote: { Args: { quote_id: string }; Returns: undefined }
      reset_route_order: {
        Args: { crew_member_id: string; route_date: string }
        Returns: undefined
      }
      save_invoice: {
        Args: {
          customer_id: string
          due_date: string
          invoice_id: string
          lines: Json
          notes: string
        }
        Returns: string
      }
      send_invoice: { Args: { invoice_id: string }; Returns: undefined }
      set_auto_invoice: { Args: { enabled: boolean }; Returns: undefined }
      set_payment_options: {
        Args: {
          cash_app: string
          pay_link: string
          payment_note: string
          paypal: string
          venmo: string
          zelle: string
        }
        Returns: undefined
      }
      set_route_order: {
        Args: { crew_member_id: string; job_ids: string[]; route_date: string }
        Returns: undefined
      }
      set_route_start: {
        Args: {
          address: string
          crew_member_id: string
          lat: number
          lon: number
          matched_address: string
          route_date: string
        }
        Returns: undefined
      }
      set_shop_location: {
        Args: {
          address: string
          city: string
          lat: number
          lon: number
          matched_address: string
          postal_code: string
          state: string
        }
        Returns: undefined
      }
      stop_service_plan: { Args: { plan_id: string }; Returns: number }
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
      geo_status: "pending" | "located" | "not_found" | "flagged"
      invoice_status: "draft" | "sent" | "cancelled"
      job_status:
        | "scheduled"
        | "assigned"
        | "en_route"
        | "in_progress"
        | "completed"
        | "unable_to_complete"
        | "weather_delay"
        | "cancelled"
      payment_method:
        | "cash"
        | "check"
        | "venmo"
        | "cash_app"
        | "paypal"
        | "zelle"
        | "card"
        | "bank_transfer"
        | "other"
      photo_kind: "before" | "after" | "other"
      request_status: "new" | "converted" | "dismissed"
      quote_status: "draft" | "sent" | "accepted" | "declined"
      service_frequency: "weekly" | "biweekly" | "triweekly" | "one_time"
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
      geo_status: ["pending", "located", "not_found", "flagged"],
      invoice_status: ["draft", "sent", "cancelled"],
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
      payment_method: [
        "cash",
        "check",
        "venmo",
        "cash_app",
        "paypal",
        "zelle",
        "card",
        "bank_transfer",
        "other",
      ],
      photo_kind: ["before", "after", "other"],
      request_status: ["new", "converted", "dismissed"],
      quote_status: ["draft", "sent", "accepted", "declined"],
      service_frequency: ["weekly", "biweekly", "triweekly", "one_time"],
    },
  },
} as const

