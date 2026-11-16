import { Center } from '@astryxdesign/core/Center';
import { Spinner } from '@astryxdesign/core/Spinner';

// Suspense fallback while a lazy page chunk loads.
export default function PageLoader() {
  return (
    <Center height="100dvh">
      <Spinner label="Loading" />
    </Center>
  );
}
