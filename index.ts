import { registerRootComponent } from "expo";
import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getMessaging,
  setBackgroundMessageHandler,
} from "@react-native-firebase/messaging";
import type { FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import App from "./App";
import {
  CallData,
  callKeepOptions,
  ANDROID_INCOMING_CALL_TIMEOUT_MS,
  isStaleCallNotification,
} from "./CallKeepOptions";
import RNCallKeep from "react-native-callkeep";
import firebaseApp from "@react-native-firebase/app";

const MESSAGE_IDS_KEY = "processed_message_ids";
const MAX_STORED_MESSAGES = 5;

const handleMessageDeduplication = async (
  messageId: string
): Promise<boolean> => {
  // Check if this message was already processed and store if not
  let storedIds: string[] = [];
  try {
    const stored = await AsyncStorage.getItem(MESSAGE_IDS_KEY);
    storedIds = stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.warn("Failed to get stored message IDs:", error);
  }

  if (storedIds.includes(messageId)) {
    console.log(
      `📱 Background: Duplicate message detected (${messageId}), ignoring`
    );
    return true; // Message is duplicate
  }

  // Store messageId to prevent duplicate processing
  const updatedIds = [messageId, ...storedIds];
  const limitedIds = updatedIds.slice(0, MAX_STORED_MESSAGES);

  try {
    await AsyncStorage.setItem(MESSAGE_IDS_KEY, JSON.stringify(limitedIds));
    console.log(
      `📝 Stored messageId: ${messageId}, total stored: ${limitedIds.length}`
    );
  } catch (error) {
    console.warn("Failed to store message ID:", error);
  }

  return false; // Message is not duplicate
};

// Firebase background handler will be set up in App.tsx after proper initialization

// registerRootComponent calls AppRegistry.registerComponent('YourAppName', () => App);
// It also ensures that whether you load the app in Expo Go or in a standalone app,
// the environment is set up appropriately
registerRootComponent(App);
