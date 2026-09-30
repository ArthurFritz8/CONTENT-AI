import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  assertBufferTikTokChannel,
  assertBufferChannel,
  createBufferTikTokPost,
  createBufferYoutubeShort,
  getBufferPostStatus,
} from "./buffer.ts";

Deno.test("Buffer schedules a single organic AI-labelled TikTok video and reads delivery status", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{ query: string; variables: Record<string, unknown> }> =
    [];
  globalThis.fetch = (async (_input, init) => {
    assertEquals(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fixture-key",
    );
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    const data = calls.length === 1
      ? { channel: { id: "channel-1", service: "tiktok" } }
      : calls.length === 2
      ? {
        createPost: {
          __typename: "PostActionSuccess",
          post: { id: "post-1", status: "scheduled", channelId: "channel-1", schedulingType: "automatic" },
        },
      }
      : { post: { id: "post-1", status: "sent", channelId: "channel-1", schedulingType: "automatic" } };
    return new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await assertBufferTikTokChannel("fixture-key", "channel-1");
    assertEquals(
      await createBufferTikTokPost("fixture-key", "channel-1", {
        caption: "Vídeo orgânico",
        videoUrl: "https://example.test/video.mp4",
        isAiGenerated: true,
      }),
      { id: "post-1", status: "scheduled" },
    );
    assertEquals(
      await getBufferPostStatus("fixture-key", "post-1", "channel-1"),
      "sent",
    );
    const input = calls[1]!.variables.input as Record<string, unknown>;
    assertEquals(input.schedulingType, "automatic");
    assertEquals(input.mode, "addToQueue");
    assertEquals(
      (input.metadata as { tiktok: { isAiGenerated: boolean } }).tiktok
        .isAiGenerated,
      true,
    );
    assertEquals(
      (input.assets as Array<{ video: { url: string } }>)[0]!.video.url,
      "https://example.test/video.mp4",
    );
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("Buffer rejects a non-TikTok channel and never retries ambiguous creation", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        data: { channel: { id: "channel-1", service: "youtube" } },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await assertRejects(() => assertBufferTikTokChannel("key", "channel-1"));
  } finally {
    globalThis.fetch = previous;
  }
  assertEquals(calls, 1);
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network timeout");
  }) as typeof fetch;
  try {
    await assertRejects(() =>
      createBufferTikTokPost("key", "channel-1", {
        caption: "Orgânico",
        videoUrl: "https://example.test/video.mp4",
        isAiGenerated: true,
      })
    );
  } finally {
    globalThis.fetch = previous;
  }
  assertEquals(calls, 2);
});

Deno.test("Buffer never treats a notification post as automatic publication", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: { createPost: { __typename: "PostActionSuccess", post: {
      id: "post-2", status: "scheduled", channelId: "channel-1", schedulingType: "notification",
    } } },
  }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    await assertRejects(() => createBufferTikTokPost("key", "channel-1", {
      caption: "Orgânico", videoUrl: "https://example.test/video.mp4", isAiGenerated: true,
    }));
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("Buffer queues an automatic public YouTube Short with explicit metadata", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{ variables: { input: Record<string, unknown> } }> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    const data = calls.length === 1
      ? { channel: { id: "youtube-1", service: "youtube" } }
      : { createPost: { __typename: "PostActionSuccess", post: {
        id: "short-1", status: "scheduled", channelId: "youtube-1", schedulingType: "automatic",
      } } };
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await assertBufferChannel("key", "youtube-1", "youtube");
    assertEquals(await createBufferYoutubeShort("key", "youtube-1", {
      title: "Título", description: "Descrição orgânica", videoUrl: "https://example.test/short.mp4",
      categoryId: "27", madeForKids: false,
    }), { id: "short-1", status: "scheduled" });
    const input = calls[1]!.variables.input;
    assertEquals(input.schedulingType, "automatic");
    assertEquals((input.metadata as { youtube: { privacy: string; title: string; categoryId: string;
      madeForKids: boolean; isAiGenerated: boolean } }).youtube,
      { title: "Título", categoryId: "27", madeForKids: false, privacy: "public", isAiGenerated: true });
  } finally { globalThis.fetch = previous; }
});
Deno.test("Buffer exact date preserves the requested UTC instant", async () => {
 const previous=globalThis.fetch;
 globalThis.fetch=(async(_url,init)=>{const body=JSON.parse(String(init?.body));assertEquals(body.variables.input.mode,"customScheduled");assertEquals(body.variables.input.dueAt,"2026-10-01T18:00:00.000Z");return Response.json({data:{createPost:{__typename:"PostActionSuccess",post:{id:"post",status:"scheduled",channelId:"channel",schedulingType:"automatic"}}}});}) as typeof fetch;
 try{await createBufferTikTokPost("fixture","channel",{caption:"Organic",videoUrl:"https://example.test/video.mp4",isAiGenerated:true,dueAt:"2026-10-01T18:00:00.000Z"});}finally{globalThis.fetch=previous;}
});
