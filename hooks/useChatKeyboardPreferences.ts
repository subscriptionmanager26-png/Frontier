import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { getChatKeyboardDiagLog } from '@/lib/appSettings';

/** Optional Metro diagnostics for chat keyboard (Settings toggle). */
export function useChatKeyboardDiagLog() {
  const [diagLog, setDiagLog] = useState(false);

  const refresh = useCallback(async () => {
    setDiagLog(await getChatKeyboardDiagLog());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return diagLog;
}
