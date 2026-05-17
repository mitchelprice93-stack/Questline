// Password input with a built-in eye toggle on the right side. Used on
// login, signup, and password-reset screens so every password field in
// the app behaves identically.
//
// Visibility is local state per input — toggling one field doesn't affect
// any sibling fields (matches OS-keychain UX on iOS and Android).

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

interface Props
  extends Omit<TextInputProps, 'secureTextEntry' | 'autoCapitalize' | 'autoComplete' | 'style'> {
  /** Hint for password managers and OS autofill. */
  autoComplete?: 'current-password' | 'new-password';
}

export function PasswordInput({ autoComplete = 'current-password', ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <View className="relative mb-4">
      <TextInput
        {...rest}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoComplete={autoComplete}
        placeholderTextColor="#78716c"
        className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 pr-12 font-body text-stone-100"
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        accessibilityRole="button"
        hitSlop={10}
        className="absolute right-3 top-1/2 -mt-3 active:opacity-60"
      >
        <MaterialCommunityIcons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={22}
          color="#a8a29e"
        />
      </Pressable>
    </View>
  );
}
