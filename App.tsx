import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PostComposer } from './src/PostComposer';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <PostComposer />
    </SafeAreaProvider>
  );
}

export default App;
