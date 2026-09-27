import { Redirect } from 'expo-router';

/** Where the app opens: signing in until there's a session (step 4 decides by /me). */
export default function Index() {
  return <Redirect href="/sign-in" />;
}
