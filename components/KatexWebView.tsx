import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  latex: string;
  displayMode: boolean;
  textColor: string;
};

function buildHtml(latex: string, displayMode: boolean, textColor: string): string {
  const texJson = JSON.stringify(latex);
  const dm = displayMode ? 'true' : 'false';
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous"/>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
<style>
html,body{margin:0;padding:0;background:transparent;}
body{color:${textColor};padding:2px 0;font-size:15px;line-height:1.35;overflow:hidden;}
.katex-display{margin:6px 0;}
</style></head><body>
<div id="o"></div>
<script>
(function(){
  var tex = ${texJson};
  var el = document.getElementById('o');
  try {
    katex.render(tex, el, { displayMode: ${dm}, throwOnError: false, errorColor: '${textColor}' });
  } catch(e) {
    el.textContent = tex;
  }
  var rect = el.getBoundingClientRect();
  var h = Math.max(el.scrollHeight, rect.height, 24);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(String(Math.ceil(h + 6)));
})();
</script></body></html>`;
}

/** Renders LaTeX via KaTeX in a WebView (CDN). Falls back to monospace text on failure. */
export function KatexWebView({ latex, displayMode, textColor }: Props) {
  const [height, setHeight] = useState(displayMode ? 56 : 28);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    const h = Number(e.nativeEvent.data);
    if (Number.isFinite(h) && h > 0) setHeight(Math.min(h, 800));
  }, []);

  if (!latex.trim()) return null;

  if (Platform.OS === 'web') {
    return (
      <View style={[displayMode ? styles.mathBlockWeb : styles.mathInlineWeb]}>
        <Text style={[styles.fallbackTex, { color: textColor }]} selectable>
          {displayMode ? `$$${latex}$$` : `$${latex}$`}
        </Text>
      </View>
    );
  }

  const html = buildHtml(latex, displayMode, textColor);

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      onMessage={onMessage}
      style={{ width: '100%', height, backgroundColor: 'transparent' }}
      androidLayerType="hardware"
    />
  );
}

const styles = StyleSheet.create({
  mathBlockWeb: { marginVertical: 6 },
  mathInlineWeb: { marginVertical: 2 },
  fallbackTex: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 14 },
});
