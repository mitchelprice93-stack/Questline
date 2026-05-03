// Cross-platform info / confirm dialogs.
//
// react-native-web's Alert is a no-op, which strands callers that rely on the
// OK button's onPress for follow-up work. We branch on Platform.OS: window.*
// on web (synchronous), native Alert.alert on iOS/Android (resolved via
// callback).

import { Alert, Platform } from 'react-native';

export function showInfoMessage(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
      resolve();
    } else {
      Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }], {
        onDismiss: () => resolve(),
      });
    }
  });
}

export function confirmDestructive(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      resolve(window.confirm(`${title}\n\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
      ]);
    }
  });
}
