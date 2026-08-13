// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type ExerciseEventType = "view" | "complete" | "skip";

interface SessionStartBody {
  type: "session_start";
  sessionId: string;
  dayKey: string;
  nameHi: string;
  nameEn: string;
  totalExercises: number;
}

interface ExerciseEventBody {
  type: "exercise_event";
  eventId: string;
  sessionId: string;
  exerciseId: string;
  sequenceIndex: number;
  eventType: ExerciseEventType;
  timeSpentMs?: number;
}

interface SessionCompleteBody {
  type: "session_complete";
  sessionId: string;
  durationMs: number;
}

interface SessionAbandonBody {
  type: "session_abandon";
  sessionId: string;
}

type TelemetryBody = SessionStartBody | ExerciseEventBody | SessionCompleteBody | SessionAbandonBody;

// auth: 'user' requires a valid JWT (anonymous sign-in counts) and scopes ctx.supabase to that user via RLS.
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Never trust a client-supplied user id — always use the verified JWT claim.
    const userId = ctx.userClaims?.id;
    if (!userId) {
      return Response.json({ error: "Unauthenticated" }, { status: 401 });
    }

    let body: TelemetryBody;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    switch (body.type) {
      case "session_start": {
        // upsert + ignoreDuplicates makes retried "start" sends safe (idempotent on the client-generated id).
        const { error } = await ctx.supabase.from("workout_sessions").upsert(
          {
            id: body.sessionId,
            user_id: userId,
            day_key: body.dayKey,
            name_hi: body.nameHi,
            name_en: body.nameEn,
            total_exercises: body.totalExercises,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      }

      case "exercise_event": {
        const { error } = await ctx.supabase.from("exercise_events").upsert(
          {
            id: body.eventId,
            session_id: body.sessionId,
            user_id: userId,
            exercise_id: body.exerciseId,
            sequence_index: body.sequenceIndex,
            event_type: body.eventType,
            time_spent_ms: body.timeSpentMs ?? null,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      }

      case "session_complete": {
        const { error } = await ctx.supabase
          .from("workout_sessions")
          .update({
            completed: true,
            completed_at: new Date().toISOString(),
            duration_ms: body.durationMs,
          })
          .eq("id", body.sessionId)
          .eq("user_id", userId);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      }

      case "session_abandon": {
        // Only mark abandonment if the session never actually finished (avoids clobbering a real completion).
        const { error } = await ctx.supabase
          .from("workout_sessions")
          .update({ abandoned_at: new Date().toISOString() })
          .eq("id", body.sessionId)
          .eq("user_id", userId)
          .is("completed_at", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: "Unknown event type" }, { status: 400 });
    }
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/telemetry' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --header 'Authorization: Bearer <anon session access token>' \
    --data '{"type":"session_start","sessionId":"...","dayKey":"mon","nameHi":"...","nameEn":"...","totalExercises":8}'

*/
