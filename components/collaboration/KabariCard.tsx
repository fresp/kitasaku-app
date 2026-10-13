import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Bell from 'lucide-react-native/icons/bell';
import { Colors, FontSize, Radius } from '../../constants/theme';
import type { HouseholdMember } from '../../lib/household';
import { defaultShareRecipients, memberName, SHARE_NOTE_MAX } from '../../lib/collaboration';

export interface KabariState {
  enabled: boolean;
  recipientIds: string[];
  note: string;
}

/**
 * Default per Phase 15: on, every other member selected. Until the member
 * touches the chips, the selection follows the roster, so a roster that loads
 * late still ends up fully selected.
 */
export function useKabariState(members: HouseholdMember[], myUserId: string | undefined) {
  const others = useMemo(() => defaultShareRecipients(members, myUserId), [members, myUserId]);
  const [enabled, setEnabled] = useState(true);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [note, setNote] = useState('');
  const state: KabariState = { enabled, recipientIds: chosen ?? others, note };
  const setState = (next: KabariState) => {
    setEnabled(next.enabled);
    setChosen(next.recipientIds);
    setNote(next.note);
  };
  /** Who actually gets the kabar right now (empty when switched off). */
  const activeRecipients = enabled ? state.recipientIds : [];
  return { state, setState, activeRecipients, hasOthers: others.length > 0 };
}

export function KabariCard({
  title,
  subtitle,
  members,
  myUserId,
  state,
  onChange,
  footer,
}: {
  title: string;
  subtitle: string;
  members: HouseholdMember[];
  myUserId: string | undefined;
  state: KabariState;
  onChange: (next: KabariState) => void;
  footer?: React.ReactNode;
}) {
  const others = members.filter((m) => !m.is_me && m.user_id !== myUserId);
  if (others.length === 0) return null;

  function toggleRecipient(userId: string) {
    const has = state.recipientIds.includes(userId);
    onChange({
      ...state,
      recipientIds: has ? state.recipientIds.filter((id) => id !== userId) : [...state.recipientIds, userId],
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Bell size={16} color={Colors.accentStrong} />
        <View style={styles.headText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Switch
          value={state.enabled}
          onValueChange={(enabled) => onChange({ ...state, enabled })}
          trackColor={{ false: Colors.borderStrong, true: Colors.paidText }}
          accessibilityLabel="Kabari anggota ruang"
        />
      </View>
      {state.enabled && (
        <>
          <View style={styles.chips}>
            {others.map((m) => {
              const on = state.recipientIds.includes(m.user_id);
              const name = memberName(members, m.user_id) ?? 'Anggota';
              return (
                <Pressable
                  key={m.user_id}
                  onPress={() => toggleRecipient(m.user_id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <View style={[styles.avatar, on && styles.avatarOn]}>
                    <Text style={[styles.avatarText, on && styles.avatarTextOn]}>
                      {name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={state.note}
            onChangeText={(note) => onChange({ ...state, note })}
            placeholder="Catatan untuk keluarga (opsional)"
            placeholderTextColor={Colors.textMuted}
            maxLength={SHARE_NOTE_MAX}
            style={styles.note}
          />
        </>
      )}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { flex: 1, gap: 2 },
  title: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  subtitle: { color: Colors.textSecondary, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    paddingLeft: 6, paddingRight: 14, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface,
  },
  chipOn: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  avatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarOn: { backgroundColor: Colors.accent },
  avatarText: { color: Colors.textSecondary, fontWeight: '700', fontSize: 12 },
  avatarTextOn: { color: Colors.navy, fontWeight: '800' },
  chipText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: Colors.white, fontWeight: '700' },
  note: {
    height: 44, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    backgroundColor: Colors.surface, paddingHorizontal: 12, fontSize: FontSize.body, color: Colors.textPrimary,
  },
});
