import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import { SecureTextField } from '@/components/settings/SecureTextField';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getShell, shellCardShadow } from '@/constants/appShell';
import {
  getAnthropicKey,
  getAzureChatCompletionsUrl,
  getAzureOpenAiKey,
  getOpenAiKey,
  getOpenAiModel,
  setAnthropicKey,
  setAzureChatCompletionsUrl,
  setAzureOpenAiKey,
  setOpenAiKey,
  setOpenAiModel,
} from '@/lib/appSettings';
import { fetchOpenAiChatModels } from '@/lib/openaiModels';

export default function SettingsAiModelScreen() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme ?? 'light';
  const s = scheme === 'dark' ? 'dark' : 'light';
  const isDark = scheme === 'dark';
  const colors = Colors[scheme];
  const shell = getShell(s);

  const [keyDraft, setKeyDraft] = useState('');
  const [azureKeyDraft, setAzureKeyDraft] = useState('');
  const [anthropicKeyDraft, setAnthropicKeyDraft] = useState('');
  const [azureChatUrl, setAzureChatUrl] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [savingAzure, setSavingAzure] = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [hasStoredAzureKey, setHasStoredAzureKey] = useState(false);
  const [hasStoredAnthropicKey, setHasStoredAnthropicKey] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [k, azk, ank, azu, m] = await Promise.all([
      getOpenAiKey(),
      getAzureOpenAiKey(),
      getAnthropicKey(),
      getAzureChatCompletionsUrl(),
      getOpenAiModel(),
    ]);
    setKeyDraft(k ? '••••••••••••••••' : '');
    setAzureKeyDraft(azk ? '••••••••••••••••' : '');
    setAnthropicKeyDraft(ank ? '••••••••••••••••' : '');
    setAzureChatUrl(azu);
    setModel(m);
    setHasStoredKey(!!k);
    setHasStoredAzureKey(!!azk);
    setHasStoredAnthropicKey(!!ank);
    setLoading(false);
  }, []);

  const pickerModels = useMemo(() => {
    if (!model) return availableModels;
    if (availableModels.includes(model)) return availableModels;
    return [model, ...availableModels];
  }, [availableModels, model]);

  const activeProvider = useMemo(() => {
    const azureReady = hasStoredAzureKey && !!azureChatUrl.trim();
    if (azureReady) return 'Azure OpenAI';
    if (hasStoredKey) return 'OpenAI';
    return 'Not configured';
  }, [hasStoredAzureKey, azureChatUrl, hasStoredKey]);

  const loadModelsFromApi = useCallback(async () => {
    const k = await getOpenAiKey();
    if (!k) {
      setAvailableModels([]);
      setModelsError(null);
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await fetchOpenAiChatModels(k);
      setAvailableModels(list);
      if (list.length === 0) {
        setModelsError('No chat models returned for this key.');
      }
    } catch (e) {
      setAvailableModels([]);
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await reload();
        await loadModelsFromApi();
      })();
    }, [reload, loadModelsFromApi])
  );

  const saveKey = async () => {
    if (keyDraft.startsWith('••')) {
      Alert.alert('API key', 'Paste a new key to replace the stored one, or clear the field to remove it.');
      return;
    }
    setSavingKey(true);
    try {
      await setOpenAiKey(keyDraft.trim() || null);
      await reload();
      await loadModelsFromApi();
      Alert.alert('Saved', 'OpenAI API key updated.');
    } finally {
      setSavingKey(false);
    }
  };

  const saveAzure = async () => {
    if (azureKeyDraft.startsWith('••')) {
      Alert.alert('API key', 'Paste a new Azure key to replace the stored one, or clear to remove it.');
      return;
    }
    if (azureChatUrl.trim() && !/^https?:\/\//i.test(azureChatUrl.trim())) {
      Alert.alert('Invalid URL', 'Azure chat URL must start with http:// or https://');
      return;
    }
    setSavingAzure(true);
    try {
      await Promise.all([
        setAzureOpenAiKey(azureKeyDraft.trim() || null),
        setAzureChatCompletionsUrl(azureChatUrl.trim()),
      ]);
      await reload();
      Alert.alert('Saved', 'Azure OpenAI settings updated.');
    } finally {
      setSavingAzure(false);
    }
  };

  const saveAnthropic = async () => {
    if (anthropicKeyDraft.startsWith('••')) {
      Alert.alert('API key', 'Paste a new Anthropic key to replace the stored one, or clear to remove it.');
      return;
    }
    setSavingAnthropic(true);
    try {
      await setAnthropicKey(anthropicKeyDraft.trim() || null);
      await reload();
      Alert.alert('Saved', 'Anthropic API key updated.');
    } finally {
      setSavingAnthropic(false);
    }
  };

  const pickModel = async (id: string) => {
    setModel(id);
    await setOpenAiModel(id);
  };

  const saveModel = async () => {
    setSavingModel(true);
    try {
      const next = model.trim() || 'gpt-4o-mini';
      await setOpenAiModel(next);
      setModel(next);
      Alert.alert('Saved', `Model set to "${next}".`);
    } finally {
      setSavingModel(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: shell.canvas }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: shell.canvas }}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.help, { color: colors.text }]}>
        Configure one or more providers. Keys stay on this device (SecureStore). Active chat provider is Azure when
        both Azure key and URL are set; otherwise OpenAI when an OpenAI key is set.
      </Text>

      <View
        style={[
          styles.providerBadge,
          { borderColor: shell.borderSubtle, backgroundColor: colors.card },
          shellCardShadow(isDark),
        ]}>
        <Text style={[styles.providerBadgeLabel, { color: colors.text }]}>Active provider</Text>
        <Text
          style={[
            styles.providerBadgeValue,
            { color: activeProvider === 'Not configured' ? colors.text : colors.tint },
          ]}>
          {activeProvider}
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>OpenAI</Text>
      <SecureTextField
        borderColor={colors.tabIconDefault}
        placeholder="sk-…"
        placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
        value={keyDraft}
        onChangeText={setKeyDraft}
        onFocus={() => {
          if (keyDraft.startsWith('••')) setKeyDraft('');
        }}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: colors.text }}
      />
      <Pressable
        onPress={saveKey}
        disabled={savingKey}
        style={[styles.primaryBtn, { backgroundColor: colors.tint, opacity: savingKey ? 0.6 : 1 }]}>
        {savingKey ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save OpenAI key</Text>}
      </Pressable>

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Azure OpenAI</Text>
      <Text style={[styles.help, { color: colors.text }]}>
        Optional. If both Azure key and chat URL are set, chat prefers Azure.
      </Text>
      <SecureTextField
        borderColor={colors.tabIconDefault}
        placeholder="Azure API key"
        placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
        value={azureKeyDraft}
        onChangeText={setAzureKeyDraft}
        onFocus={() => {
          if (azureKeyDraft.startsWith('••')) setAzureKeyDraft('');
        }}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: colors.text }}
      />
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.tabIconDefault }]}
        placeholder="https://.../openai/deployments/<deployment>/chat/completions?api-version=..."
        placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
        value={azureChatUrl}
        onChangeText={setAzureChatUrl}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        onPress={saveAzure}
        disabled={savingAzure}
        style={[styles.primaryBtn, { backgroundColor: colors.tint, opacity: savingAzure ? 0.6 : 1 }]}>
        {savingAzure ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Save Azure settings</Text>
        )}
      </Pressable>
      {hasStoredAzureKey ? (
        <Text style={[styles.muted, { color: colors.text }]}>Azure key stored on device.</Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Anthropic</Text>
      <Text style={[styles.help, { color: colors.text }]}>
        Optional. Used by some agent channels when no A2A URL is set.
      </Text>
      <SecureTextField
        borderColor={colors.tabIconDefault}
        placeholder="sk-ant-..."
        placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
        value={anthropicKeyDraft}
        onChangeText={setAnthropicKeyDraft}
        onFocus={() => {
          if (anthropicKeyDraft.startsWith('••')) setAnthropicKeyDraft('');
        }}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: colors.text }}
      />
      <Pressable
        onPress={saveAnthropic}
        disabled={savingAnthropic}
        style={[styles.primaryBtn, { backgroundColor: colors.tint, opacity: savingAnthropic ? 0.6 : 1 }]}>
        {savingAnthropic ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Save Anthropic key</Text>
        )}
      </Pressable>
      {hasStoredAnthropicKey ? (
        <Text style={[styles.muted, { color: colors.text }]}>Anthropic key stored on device.</Text>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Model name</Text>
      <Text style={[styles.help, { color: colors.text }]}>
        Deployment or model id (for Azure, match your deployment name).
      </Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.tabIconDefault }]}
        placeholder="gpt-4o-mini"
        placeholderTextColor={scheme === 'dark' ? '#888' : '#999'}
        value={model}
        onChangeText={setModel}
        onSubmitEditing={saveModel}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        onPress={saveModel}
        disabled={savingModel}
        style={[styles.primaryBtn, { backgroundColor: colors.tint, opacity: savingModel ? 0.6 : 1 }]}>
        {savingModel ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Save model</Text>
        )}
      </Pressable>
      {!hasStoredKey ? (
        <Text style={[styles.muted, { color: colors.text }]}>
          Add an OpenAI key to load your account model list (optional).
        </Text>
      ) : (
        <>
          <Pressable
            onPress={() => pickerModels.length > 0 && setModelPickerOpen(true)}
            disabled={pickerModels.length === 0 || modelsLoading}
            style={[
              styles.dropdown,
              {
                borderColor: colors.tabIconDefault,
                opacity: pickerModels.length === 0 || modelsLoading ? 0.55 : 1,
              },
            ]}>
            {modelsLoading ? (
              <View style={styles.dropdownLoading}>
                <ActivityIndicator color={colors.tint} />
              </View>
            ) : (
              <>
                <Text style={[styles.dropdownValue, { color: colors.text }]} numberOfLines={1}>
                  {model}
                </Text>
                <FontAwesome name="chevron-down" size={14} color={colors.tabIconDefault} />
              </>
            )}
          </Pressable>
          {modelsError ? (
            <View style={styles.modelErrRow}>
              <Text style={[styles.modelErr, { color: colors.text }]} numberOfLines={3}>
                {modelsError}
              </Text>
              <Pressable onPress={loadModelsFromApi} style={styles.retryBtn}>
                <Text style={{ color: colors.tint, fontWeight: '600' }}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}

      <Modal visible={modelPickerOpen} animationType="slide" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setModelPickerOpen(false)}>
          <Pressable
            style={[styles.pickerSheet, { backgroundColor: colors.background }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>OpenAI models</Text>
            <FlatList
              data={pickerModels}
              keyExtractor={(id) => id}
              style={styles.pickerList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: id }) => (
                <Pressable
                  style={[
                    styles.pickerRow,
                    { borderBottomColor: colors.tabIconDefault },
                    model === id && { backgroundColor: `${colors.tint}18` },
                  ]}
                  onPress={async () => {
                    await pickModel(id);
                    setModelPickerOpen(false);
                  }}>
                  <Text style={{ color: colors.text, fontSize: 16 }}>{id}</Text>
                  {model === id ? <FontAwesome name="check" size={16} color={colors.tint} /> : null}
                </Pressable>
              )}
            />
            <Pressable onPress={() => setModelPickerOpen(false)} style={styles.pickerClose}>
              <Text style={{ color: colors.tint, fontWeight: '600' }}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 22, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  providerBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  providerBadgeLabel: { fontSize: 13, opacity: 0.75, fontWeight: '600' },
  providerBadgeValue: { fontSize: 14, fontWeight: '700' },
  help: { fontSize: 14, opacity: 0.75, lineHeight: 20, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  muted: { fontSize: 14, opacity: 0.65, marginBottom: 8 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 48,
    gap: 8,
  },
  dropdownValue: { flex: 1, fontSize: 16 },
  modelErrRow: { marginTop: 8, gap: 8 },
  modelErr: { fontSize: 13, opacity: 0.85 },
  retryBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
  dropdownLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 20 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
  },
  pickerTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginBottom: 8 },
  pickerList: { flexGrow: 0 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerClose: { paddingVertical: 16, alignItems: 'center' },
});
