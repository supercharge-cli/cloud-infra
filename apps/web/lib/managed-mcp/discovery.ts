import snapshot from './openai-discovery.json';

export type DiscoveryEntry = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  category: string;
  auth: string;
  url: string;
};

const commit = snapshot.source.commit;
if (snapshot.source.repository !== 'openai/plugins' || !/^[a-f0-9]{40}$/.test(commit) ||
    snapshot.plugins.length !== 65 ||
    new Set(snapshot.plugins.map((entry) => entry.id)).size !== snapshot.plugins.length ||
    snapshot.plugins.some((entry) => !/^openai-[a-z0-9-]+$/.test(entry.id) ||
      !entry.url.startsWith(`https://github.com/openai/plugins/`) ||
      !entry.url.includes(`/${commit}/`) || !entry.name.trim() || !entry.description.trim())) {
  throw new Error('Invalid pinned OpenAI plugin discovery snapshot');
}

export const DISCOVERY: { source: { repository: string; commit: string }; plugins: readonly DiscoveryEntry[] } = snapshot;
