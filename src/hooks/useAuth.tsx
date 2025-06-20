// src/hooks/useAuth.tsx

import React, { createContext, useState, useEffect, useContext } from "react";
import { supabase } from "../services/supabase/client"; // Correct path
import { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { safeStorage } from "../utils/safeStorage";
import type {
  User,
  UserProfile,
  UserPreferences,
  UserPoints,
  UserStreaks,
} from "../types";

// If you have database types in a separate file:
// import { TABLES, RPC_FUNCTIONS } from "../types/database";
// Otherwise, define them here:
const TABLES = {
  USERS: "users",
  USER_PROFILES: "user_profiles",
  USER_PREFERENCES: "user_preferences",
  USER_POINTS: "user_points",
  USER_STREAKS: "user_streaks",
  USER_ROLES: "user_roles",
} as const;

const RPC_FUNCTIONS = {
  CREATE_USER_WITH_PROFILE: "create_user_with_profile",
} as const;

interface AuthError {
  message: string;
  code?: string;
  originalError?: any;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: AuthError | null;
  signInAnonymously: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

// Database user type that matches your Supabase schema
interface DatabaseUserWithRelations {
  id: string;
  auth_id: string;
  email: string | null;
  is_anonymous: boolean;
  display_name: string | null;
  created_at: string;
  updated_at: string;
  profile?: any;
  preferences?: any;
  points?: any;
  streaks?: any;
  roles?: any[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuthError | null>(null);

  /**
   * Transform database user to app user format
   */
  const transformDatabaseUser = (
    dbUser: DatabaseUserWithRelations
  ): User | null => {
    if (!dbUser) return null;

    return {
      id: dbUser.id,
      email: dbUser.email,
      is_anonymous: dbUser.is_anonymous,
      profile: dbUser.profile
        ? {
            firstName: dbUser.profile.first_name,
            lastName: dbUser.profile.last_name,
            age: dbUser.profile.age,
            gender: dbUser.profile.gender,
            healthGoals: dbUser.profile.health_goals || [],
            conditions: dbUser.profile.conditions || [],
            medications: dbUser.profile.medications || [],
            allergies: dbUser.profile.allergies || [],
            genetics: dbUser.profile.genetics || null,
          }
        : {
            firstName: null,
            lastName: null,
            age: null,
            gender: null,
            healthGoals: [],
            conditions: [],
            medications: [],
            allergies: [],
            genetics: null,
          },
      preferences: dbUser.preferences
        ? {
            aiResponseStyle: dbUser.preferences.ai_response_style || "concise",
            budgetRange: dbUser.preferences.budget_range || "mid",
            primaryFocus: dbUser.preferences.primary_focus || "safety",
            notifications: dbUser.preferences.notifications || {
              push_enabled: true,
              email_enabled: true,
              reminder_frequency: "daily",
            },
          }
        : {
            aiResponseStyle: "concise",
            budgetRange: "mid",
            primaryFocus: "safety",
            notifications: {
              push_enabled: true,
              email_enabled: true,
              reminder_frequency: "daily",
            },
          },
      points: dbUser.points
        ? {
            total: dbUser.points.total_points || 0,
            level: dbUser.points.level || 1,
            levelTitle: getLevelTitle(dbUser.points.level || 1),
            nextLevelAt:
              (Math.floor((dbUser.points.total_points || 0) / 100) + 1) * 100,
          }
        : undefined,
      streaks: dbUser.streaks
        ? {
            current: dbUser.streaks.current_streak || 0,
            longest: dbUser.streaks.longest_streak || 0,
            lastActivity: dbUser.streaks.last_activity_date,
          }
        : undefined,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
    };
  };

  /**
   * Get level title based on level number
   */
  const getLevelTitle = (level: number): string => {
    const titles = [
      "Health Novice",
      "Wellness Explorer",
      "Supplement Scholar",
      "Nutrition Navigator",
      "Health Guardian",
      "Wellness Warrior",
      "Supplement Sage",
      "Health Master",
      "Wellness Wizard",
      "PharmaGuide Legend",
    ];
    return titles[Math.min(level - 1, titles.length - 1)];
  };

  /**
   * Fetch user with all relations
   */
  const fetchUserWithRelations = async (
    authId: string
  ): Promise<DatabaseUserWithRelations | null> => {
    const { data, error } = await supabase
      .from(TABLES.USERS)
      .select(
        `
        *,
        profile:${TABLES.USER_PROFILES}(*),
        preferences:${TABLES.USER_PREFERENCES}(*),
        points:${TABLES.USER_POINTS}(*),
        streaks:${TABLES.USER_STREAKS}(*)
      `
      )
      .eq("auth_id", authId)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      return null;
    }

    return data as DatabaseUserWithRelations;
  };

  /**
   * Create or update user in database
   */
  const createOrUpdateUser = async (
    authUser: SupabaseUser
  ): Promise<User | null> => {
    try {
      // Call RPC to create user and related records
      const { data: userId, error: rpcError } = await supabase.rpc(
        RPC_FUNCTIONS.CREATE_USER_WITH_PROFILE,
        {
          p_auth_id: authUser.id,
          p_email: authUser.email || null,
          p_is_anonymous: !authUser.email,
        }
      );

      if (rpcError) {
        console.error("RPC error:", rpcError);
        throw rpcError;
      }

      // Fetch the complete user record
      const dbUser = await fetchUserWithRelations(authUser.id);
      if (!dbUser) {
        throw new Error("Failed to fetch user after creation");
      }

      return transformDatabaseUser(dbUser);
    } catch (error) {
      console.error("Error creating/updating user:", error);
      return null;
    }
  };

  /**
   * Initialize auth state
   */
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Get current session
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (currentSession?.user) {
          setSession(currentSession);
          const profile = await createOrUpdateUser(currentSession.user);
          setUser(profile);

          if (profile) {
            await safeStorage.setItem("current_user_id", profile.id);
          }
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event);

      if (session?.user) {
        setSession(session);
        const profile = await createOrUpdateUser(session.user);
        setUser(profile);

        if (profile) {
          await safeStorage.setItem("current_user_id", profile.id);
        }
      } else {
        setSession(null);
        setUser(null);
        await safeStorage.removeItem("current_user_id");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Sign in anonymously
   */
  const signInAnonymously = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signInAnonymously();

      if (error) throw error;

      if (data.user) {
        const profile = await createOrUpdateUser(data.user);
        setUser(profile);

        if (profile) {
          await safeStorage.setItem("current_user_id", profile.id);
        }
      }
    } catch (error: any) {
      setError({
        message: error.message || "Failed to sign in anonymously",
        code: error.code || "auth/anonymous-failed",
        originalError: error,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sign in with email
   */
  const signInWithEmail = async (
    email: string,
    password: string
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        const profile = await createOrUpdateUser(data.user);
        setUser(profile);

        if (profile) {
          await safeStorage.setItem("current_user_id", profile.id);
        }
      }
    } catch (error: any) {
      setError({
        message: error.message || "Failed to sign in",
        code: error.code || "auth/sign-in-failed",
        originalError: error,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sign up with email
   */
  const signUpWithEmail = async (
    email: string,
    password: string
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        const profile = await createOrUpdateUser(data.user);
        setUser(profile);

        if (profile) {
          await safeStorage.setItem("current_user_id", profile.id);
        }
      }
    } catch (error: any) {
      setError({
        message: error.message || "Failed to sign up",
        code: error.code || "auth/sign-up-failed",
        originalError: error,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sign out
   */
  const signOut = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      setUser(null);
      setSession(null);
      await safeStorage.removeItem("current_user_id");
    } catch (error: any) {
      setError({
        message: error.message || "Failed to sign out",
        code: error.code || "auth/sign-out-failed",
        originalError: error,
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Refresh user data
   */
  const refreshUser = async (): Promise<void> => {
    if (!session?.user) return;

    try {
      const dbUser = await fetchUserWithRelations(session.user.id);
      if (dbUser) {
        const transformedUser = transformDatabaseUser(dbUser);
        setUser(transformedUser);
      }
    } catch (error) {
      console.error("Error refreshing user:", error);
    }
  };

  /**
   * Clear error
   */
  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        error,
        signInAnonymously,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        clearError,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
