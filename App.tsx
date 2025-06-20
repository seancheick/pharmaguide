// App.tsx
import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { AuthProvider, useAuth } from "./src/hooks/useAuth";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { performanceMonitor } from "./src/services/performance/performanceMonitor";
import { gamificationService } from "./src/services/gamification/gamificationService";
import * as FileSystem from "expo-file-system";

// Wrapper component to access auth context
function AppContent() {
  const { user } = useAuth();

  useEffect(() => {
    // Set user ID for gamification service when auth state changes
    if (user && !user.is_anonymous) {
      gamificationService.setUserId(user.id);
    } else {
      gamificationService.setUserId(null);
    }
  }, [user]);

  return (
    <>
      <AppNavigator />
      <StatusBar style="auto" />
    </>
  );
}

export default function App() {
  useEffect(() => {
    // Start measuring app cold start time
    performanceMonitor.startMeasure("cold_start");

    // Ensure the @anonymous directory exists for storage
    const ensureDirectoryExists = async () => {
      const anonymousDir = `${FileSystem.documentDirectory}ExponentExperienceData/@anonymous`;
      try {
        const dirInfo = await FileSystem.getInfoAsync(anonymousDir);
        if (!dirInfo.exists || !dirInfo.isDirectory) {
          await FileSystem.makeDirectoryAsync(anonymousDir, {
            intermediates: true,
          });
          console.log(`Created directory: ${anonymousDir}`);
        }
      } catch (error) {
        console.error(`Failed to create directory: ${error}`);
      }
    };

    ensureDirectoryExists();
  }, []);

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
