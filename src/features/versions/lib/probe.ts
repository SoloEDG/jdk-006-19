/**
 * 逐条探测新录音是否可加载。任一失败，整次补丁启用都应取消，
 * 不留下「一半新、一半旧」的声音库。
 */
export function probeAudioSource(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof Audio === "undefined") {
      resolve();
      return;
    }
    const audio = new Audio();
    let settled = false,
      timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      error ? reject(error) : resolve();
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error(source));
    audio.onabort = () => finish(new Error(source));
    timer =
      typeof window !== "undefined"
        ? window.setTimeout(() => finish(new Error(source)), 12000)
        : null;
    audio.src = source;
    audio.load();
  });
}

export async function probeAll(sources: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const source of sources) {
    try {
      await probeAudioSource(source);
    } catch {
      failed.push(source);
    }
  }
  return failed;
}
