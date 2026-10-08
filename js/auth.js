// Shared anonymous Supabase session for telemetry and browser-scoped progress.
(function () {
  let client = null;
  let sessionPromise = null;

  function getClient() {
    if (!client) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: "workoutApp:supabaseAuth",
        },
      });
    }
    return client;
  }

  function getAuthenticatedClient() {
    if (sessionPromise) return sessionPromise;

    const promise = (async () => {
      const supabaseClient = getClient();
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session) return supabaseClient;

      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) throw error;
      if (!data.session) throw new Error("Anonymous session was not created.");
      return supabaseClient;
    })();

    sessionPromise = promise.catch((error) => {
      sessionPromise = null;
      throw error;
    });
    return sessionPromise;
  }

  window.WorkoutAuth = {
    getAuthenticatedClient,
  };
})();
