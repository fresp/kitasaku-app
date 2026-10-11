import { StyleProp, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiahInput } from '../../lib/format';

/**
 * The amount field, formatted as it is typed.
 *
 * The screens used to render a number-pad input holding raw digits with a
 * formatted echo underneath, so the figure being typed and the figure being
 * read sat in two places and the field cost two lines in a sheet that already
 * has six.
 *
 * "Rp" is a sibling of the input, not part of its value: a prefix inside the
 * text can be eaten by a backspace or stranded by a tap in the middle, and
 * then has to be defended in every handler. Here it cannot be touched at all.
 *
 * Known tradeoff: reformatting on every keystroke puts the caret at the end,
 * so inserting a digit mid-number appends instead. For a field that is almost
 * always typed from empty this does not bite; fixing it properly means mapping
 * the caret by digit count rather than character count.
 */
export function MoneyInput({
  label,
  value,
  onChangeText,
  placeholder = '0',
  editable = true,
  style,
  children,
}: {
  label: string;
  /** Raw text as held by the screen; may be digits or already formatted. */
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Delta or consequence lines rendered under the amount. */
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.box, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Text style={styles.affix}>Rp</Text>
        <TextInput
          value={formatRupiahInput(value)}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          placeholder={placeholder}
          placeholderTextColor={Colors.borderStrong}
          editable={editable}
          style={styles.input}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1.5,
    borderColor: Colors.brandPrimary,
    borderRadius: Radius.md,
    padding: 12,
    gap: 2,
    backgroundColor: Colors.surface,
  },
  label: {
    color: Colors.textMuted,
    fontSize: FontSize.microLabel,
    fontWeight: '700',
    letterSpacing: 1,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 3 },
  affix: { color: Colors.textMuted, fontSize: 17, fontWeight: '700' },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
});
