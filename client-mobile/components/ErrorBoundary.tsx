// client-mobile/components/ErrorBoundary.tsx
// React has no hook equivalent for catching a render-time crash in a child
// — componentDidCatch/getDerivedStateFromError only exist on class
// components. Before this, an uncaught error anywhere in the tree (a bad
// selector, a null-access on new data, etc.) unmounted silently with zero
// signal — the exact failure mode behind the "Discover just goes blank,
// no error, no spinner" report (2026-08-03). This is the app's only
// safety net for that class of bug.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

function ErrorFallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.textPrimary }]}>Something went wrong</Text>
      <Text style={[styles.message, { color: c.textSecondary }]}>{message}</Text>
      <PressableScale
        style={[styles.retryBtn, { backgroundColor: c.accentDim, borderColor: c.accentInk }]}
        onPress={onRetry}
      >
        <Text style={[styles.retryText, { color: c.accentInk }]}>Try again</Text>
      </PressableScale>
    </View>
  );
}

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          message={this.state.error.message || 'An unexpected error occurred.'}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
