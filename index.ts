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

// Background message handler for Firebase (when app is killed or backgrounded)
// This must be set at module level, outside of any component
if (Platform.OS == "android") {
  console.log("🔧 Setting up Firebase background message handler...");
  const hasDefaultFirebaseApp = (() => {
    try {
      // RNFirebase v23 provides a default export with .app() only if initialized
      // apps() is not public; detect via try/catch on getMessaging
      getMessaging();
      return true;
    } catch {
      return false;
    }
  })();

  if (hasDefaultFirebaseApp) {
    try {
      const messagingInstance = getMessaging();
      setBackgroundMessageHandler(
        messagingInstance,
        async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
          console.log("📱 FCM background message received:", remoteMessage);

          // Handle high priority data messages for calls
          if (!remoteMessage.data) {
            console.log("📱 Background: No data in message, ignoring");
            return;
          }
          const isCallMessage = remoteMessage.data?.type === "incoming_call";

          if (!isCallMessage) {
            console.log("📱 Background: Non-call message, ignoring");
            return;
          }

          // Check for duplicate messages using messageId
          const messageId = remoteMessage.messageId;

          if (!messageId) {
            console.log("📱 Background: No messageId in message, ignoring");
            return;
          }
          console.log(
            `📱 Background: Received call message with messageId ${messageId}`
          );

          // Check for duplicate message and store if not duplicate
          if (await handleMessageDeduplication(messageId)) {
            return;
          }

          try {
            const callData = remoteMessage.data as unknown as CallData;
            const callerName = callData.callerName || "Unknown Caller";
            const callUUID = callData.callId as string;

            // // Display call using callKeepService [ NOT WORKING ]
            // try {
            //   CallKeepService.setup("background");
            //   CallKeepService.handleIncomingCall(callData);
            //   console.log("✅ Call displayed successfully via CallKeepService");
            //   return;
            // } catch (error) {
            //   console.error(
            //     "❌ Failed to display incoming call via CallKeepService:",
            //     error
            //   );
            // }

            console.log(
              `📞 Background: Processing call from ${callerName} (${callUUID})`
            );

            // Attempt to display call using native module
            try {
              console.log(
                "🔄 Background: Attempting native displayIncomingCall"
              );

              const RNCallKeepModule = NativeModules.RNCallKeep;

              if (RNCallKeepModule && RNCallKeepModule.displayIncomingCall) {
                // Setup RNCallKeep [ THIS HELPS IN BRINGING APP TO FOREGROUND WHEN CALL ANSWERED ]
                RNCallKeep.setup(callKeepOptions);
                RNCallKeep.setAvailable(true);

                // Register event handlers
                const answerCallHandler = ({
                  callUUID,
                }: {
                  callUUID: string;
                }) => {
                  console.log(
                    "📞 Background: Call answered event received:",
                    callUUID
                  );

                  try {
                    console.log("🚀 Background: Bringing app to foreground");
                    RNCallKeep.backToForeground();

                    console.log("📞 Background: Ending call immediately");
                    RNCallKeep.endCall(callUUID);
                    console.log("✅ Background: Call ended successfully");
                  } catch (endError) {
                    console.log(
                      "⚠️ Background: Call end failed, trying endAllCalls:",
                      endError
                    );

                    try {
                      RNCallKeep.endAllCalls();
                      console.log("✅ Background: endAllCalls successful");
                    } catch (allError) {
                      console.log(
                        "❌ Background: endAllCalls failed:",
                        allError
                      );
                    }
                  }
                };

                const endCallHandler = ({ callUUID }: { callUUID: string }) => {
                  console.log(
                    "📞 Background: Call ended event received:",
                    callUUID
                  );

                  cleanUpRNCallKeepHandlers();
                };

                RNCallKeep.addEventListener("answerCall", answerCallHandler);
                RNCallKeep.addEventListener("endCall", endCallHandler);

                const cleanUpRNCallKeepHandlers = () => {
                  // Cleanup event listeners after call is handled
                  RNCallKeep.removeEventListener("answerCall");
                  RNCallKeep.removeEventListener("endCall");
                  console.log("🧹 Background: Event listeners cleaned up");
                };

                console.log(
                  "✅ Background: CallKeep event handlers registered"
                );

                // Use native module to display call (works in background)
                RNCallKeepModule.displayIncomingCall(
                  callUUID,
                  callerName,
                  callerName,
                  false
                );
                console.log(
                  "✅ Background: Native displayIncomingCall successful"
                );
              } else {
                console.error(
                  "❌ Background: RNCallKeep native module not available"
                );
              }
            } catch (error) {
              console.error(
                "❌ Background: Failed to display incoming call via native module:",
                error
              );
            }
          } catch (error) {
            console.error(
              "❌ Background: Failed to display incoming call:",
              error
            );
          }
        }
      );
      console.log(
        "✅ Firebase messaging background handler set up successfully"
      );
    } catch (error) {
      console.warn(
        "⚠️ Firebase not initialized yet, background handler will be set up later:",
        error
      );
    }
  } else {
    console.log(
      "ℹ️ Skipping Firebase background handler: Firebase not initialized"
    );
  }
}

// registerRootComponent calls AppRegistry.registerComponent('YourAppName', () => App);
// It also ensures that whether you load the app in Expo Go or in a standalone app,
// the environment is set up appropriately
registerRootComponent(App);
