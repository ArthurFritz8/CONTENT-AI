import { z } from "zod";
import { AppError } from "./error-handler.ts";

const endpoint = "https://api.buffer.com";
const postStatus = z.enum([
  "draft",
  "error",
  "needs_approval",
  "scheduled",
  "sending",
  "sent",
]);

async function queryBuffer<T>(
  key: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  // createPost is not idempotent. Never retry an ambiguous request automatically.
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new AppError(
      "Resposta incerta do Buffer; conferir fila antes de qualquer novo envio",
      502,
      "BUFFER_UNCERTAIN",
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new AppError(
      `Buffer respondeu HTTP ${response.status}`,
      502,
      "BUFFER_HTTP_ERROR",
    );
  }
  const payload = await response.json().catch(() => null);
  if (!payload || !payload.data || payload.errors?.length) {
    throw new AppError(
      "Buffer devolveu resposta inválida; conferir fila",
      502,
      "BUFFER_UNCERTAIN",
    );
  }
  return payload.data as T;
}

export async function assertBufferTikTokChannel(
  key: string,
  channelId: string,
): Promise<void> {
  const data = await queryBuffer<{ channel?: { id: string; service: string } }>(
    key,
    "query Channel($input: ChannelInput!) { channel(input: $input) { id service } }",
    { input: { id: channelId } },
  );
  if (data.channel?.id !== channelId || data.channel.service !== "tiktok") {
    throw new AppError(
      "O canal Buffer configurado não é TikTok",
      409,
      "BUFFER_CHANNEL_MISMATCH",
    );
  }
}

export async function createBufferTikTokPost(
  key: string,
  channelId: string,
  post: { caption: string; videoUrl: string; isAiGenerated: boolean },
): Promise<{ id: string; status: string }> {
  const data = await queryBuffer<
    {
      createPost?: {
        __typename: string;
        message?: string;
        post?: { id: string; status: string; channelId: string };
      };
    }
  >(
    key,
    `mutation QueueTikTok($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id status channelId } }
        ... on MutationError { message }
      }
    }`,
    {
      input: {
        text: post.caption,
        channelId,
        schedulingType: "automatic",
        mode: "addToQueue",
        aiAssisted: true,
        metadata: { tiktok: { isAiGenerated: post.isAiGenerated } },
        assets: [{ video: { url: post.videoUrl } }],
      },
    },
  );
  if (data.createPost?.__typename !== "PostActionSuccess") {
    throw new AppError(
      data.createPost?.message ?? "Buffer não aceitou o vídeo",
      409,
      "BUFFER_REJECTED",
    );
  }
  const saved = z.object({
    id: z.string().min(1).max(128),
    status: postStatus,
    channelId: z.string(),
  }).parse(data.createPost.post);
  if (
    saved.channelId !== channelId || saved.status === "draft" ||
    saved.status === "needs_approval"
  ) {
    throw new AppError(
      "Buffer não confirmou agendamento automático; conferir fila",
      502,
      "BUFFER_UNCERTAIN",
    );
  }
  return { id: saved.id, status: saved.status };
}

export async function getBufferPostStatus(
  key: string,
  postId: string,
  channelId: string,
) {
  const data = await queryBuffer<
    { post?: { id: string; status: string; channelId: string } }
  >(
    key,
    "query Post($input: PostInput!) { post(input: $input) { id status channelId } }",
    { input: { id: postId } },
  );
  if (!data.post) {
    throw new AppError(
      "Post não encontrado no Buffer",
      404,
      "BUFFER_POST_MISSING",
    );
  }
  const saved = z.object({
    id: z.string(),
    channelId: z.string(),
    status: postStatus,
  }).parse(data.post);
  if (saved.id !== postId || saved.channelId !== channelId) {
    throw new AppError(
      "Post do Buffer pertence a outro canal",
      409,
      "BUFFER_CHANNEL_MISMATCH",
    );
  }
  return saved.status;
}
