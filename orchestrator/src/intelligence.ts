import { logger, getOpsClient, getAnthropicClient, DEFAULT_MODEL } from '@solo/shared';

/**
 * Intelligence Report Generator
 * Crawls Reddit for a specific professional's vertical + custom topics,
 * analyzes with Claude, stores results in intelligence_reports.
 */

// ── Vertical keyword defaults ──────────────────────────────
const VERTICAL_KEYWORDS: Record<string, { keywords: string[]; subreddits: string[] }> = {
  sololawyer: {
    keywords: ['solo attorney', 'small law firm', 'legal intake', 'missed client calls lawyer', 'law firm AI'],
    subreddits: ['LawFirm', 'smallbusiness'],
  },
  solotherapist: {
    keywords: ['private practice therapist', 'therapy intake', 'client no-shows therapist', 'solo therapist burnout'],
    subreddits: ['therapists', 'psychotherapy'],
  },
  solovet: {
    keywords: ['vet clinic management', 'veterinary practice', 'missed appointments vet'],
    subreddits: ['veterinary', 'smallbusiness'],
  },
  solorealtor: {
    keywords: ['solo realtor leads', 'real estate follow-up', 'realtor missed calls'],
    subreddits: ['realtors', 'RealEstate'],
  },
  soloaccountant: {
    keywords: ['solo accountant', 'tax season overwhelmed', 'accounting firm intake'],
    subreddits: ['accounting', 'taxpros'],
  },
  soloinsure: {
    keywords: ['insurance agent leads', 'solo insurance agency'],
    subreddits: ['insurance', 'smallbusiness'],
  },
  solosocialworker: {
    keywords: ['social worker burnout', 'private practice social work'],
    subreddits: ['socialwork', 'privatepractice'],
  },
  solotraveladvisor: {
    keywords: ['travel agent clients', 'solo travel advisor'],
    subreddits: ['TravelAgents', 'smallbusiness'],
  },
};

const DEFAULT_KEYWORDS = {
  keywords: ['solo business owner', 'solopreneur challenges', 'small business AI', 'missed calls clients', 'client follow up'],
  subreddits: ['smallbusiness', 'Entrepreneur'],
};

interface RedditPost {
  title: string;
  selftext: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
}

async function searchReddit(query: string, subreddit?: string, limit = 20): Promise<RedditPost[]> {
  const base = subreddit
    ? `https://www.reddit.com/r/${subreddit}/search.json`
    : `https://www.reddit.com/search.json`;

  const params = new URLSearchParams({
    q: query,
    sort: 'relevance',
    t: 'week',
    limit: String(limit),
    raw_json: '1',
    ...(subreddit ? { restrict_sr: 'on' } : {}),
  });

  try {
    const res = await fetch(`${base}?${params}`, {
      headers: { 'User-Agent': 'SoloSolutionsAI/1.0 (market-research)' },
    });

    if (!res.ok) {
      logger.warn(`Reddit ${res.status} for "${query}" in ${subreddit || 'all'}`);
      return [];
    }

    const data = await res.json();
    return (data.data?.children || []).map((c: any) => ({
      title: c.data.title,
      selftext: (c.data.selftext || '').slice(0, 500),
      subreddit: c.data.subreddit,
      score: c.data.score,
      num_comments: c.data.num_comments,
      url: `https://reddit.com${c.data.permalink}`,
    }));
  } catch (err) {
    logger.error({ err }, `Reddit fetch failed for "${query}"`);
    return [];
  }
}

async function crawl(vertical: string, customTopics: string[]): Promise<{ posts: RedditPost[]; searchesRun: number }> {
  const config = VERTICAL_KEYWORDS[vertical] || DEFAULT_KEYWORDS;
  const allKeywords = [...config.keywords, ...customTopics].slice(0, 8);
  const posts: RedditPost[] = [];
  const seen = new Set<string>();
  let searchesRun = 0;

  for (const keyword of allKeywords) {
    await new Promise(r => setTimeout(r, 1500));
    const results = await searchReddit(keyword, undefined, 20);
    searchesRun++;
    for (const post of results) {
      if (!seen.has(post.url)) {
        seen.add(post.url);
        posts.push(post);
      }
    }
  }

  for (const sub of config.subreddits.slice(0, 2)) {
    for (const kw of ['struggling', 'AI tools']) {
      await new Promise(r => setTimeout(r, 1500));
      const results = await searchReddit(kw, sub, 10);
      searchesRun++;
      for (const post of results) {
        if (!seen.has(post.url)) {
          seen.add(post.url);
          posts.push(post);
        }
      }
    }
  }

  return { posts, searchesRun };
}

async function analyze(posts: RedditPost[], vertical: string, customTopics: string[]): Promise<any> {
  if (posts.length === 0) {
    return { themes: [], pain_points: [], hooks: [], trending_topics: [], suggested_content: [], verbatim_quotes: [] };
  }

  const anthropic = getAnthropicClient();
  const postSummaries = posts
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(p => `[r/${p.subreddit} | ${p.score}pts | ${p.num_comments} comments]\n${p.title}\n${p.selftext ? p.selftext.slice(0, 200) : ''}`)
    .join('\n---\n');

  const customContext = customTopics.length > 0
    ? `\nThe user also wants insights on: ${customTopics.join(', ')}` : '';

  const result = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 2000,
    system: `You are a market intelligence analyst for solo professionals. Analyze Reddit discussions and extract actionable insights.

Return valid JSON with this exact structure:
{
  "themes": [{"title": "string", "frequency": number, "sentiment": "positive|negative|neutral", "summary": "1-2 sentences"}],
  "pain_points": ["string - specific pain point with context"],
  "hooks": ["string - marketing hook or angle derived from the discussions"],
  "trending_topics": ["string - topic gaining traction"],
  "suggested_content": [{"platform": "linkedin|facebook|instagram", "post": "ready-to-use post text under 280 chars"}],
  "verbatim_quotes": [{"quote": "exact quote from post", "subreddit": "string", "score": number}]
}

Provide 3-5 items per array. Focus on insights relevant to the ${vertical} vertical.${customContext}
Be specific — not generic business advice. Pull real patterns from the data.`,
    messages: [
      { role: 'user', content: `Analyze these ${posts.length} Reddit discussions from the past week:\n\n${postSummaries}` },
    ],
  });

  const text = result.content[0].type === 'text' ? result.content[0].text : '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    logger.error('Failed to parse intelligence analysis');
    return { themes: [], pain_points: [], hooks: [], trending_topics: [], suggested_content: [], verbatim_quotes: [] };
  }
}

/** Main entry point — called by the HTTP endpoint */
export async function generateReport(professionalId: string): Promise<any> {
  const ops = getOpsClient();

  logger.info({ professionalId }, 'Starting intelligence report generation');

  // Get profile
  const { data: profile } = await ops
    .from('professional_profiles')
    .select('vertical_config')
    .eq('id', professionalId)
    .single();

  if (!profile) throw new Error('Profile not found');

  // Get custom topics
  const { data: topics } = await ops
    .from('professional_research_topics')
    .select('topic')
    .eq('professional_id', professionalId)
    .eq('active', true);

  const customTopics = (topics || []).map((t: any) => t.topic);
  const vertical = (profile.vertical_config as any)?.vertical || 'default';

  logger.info({ vertical, customTopics: customTopics.length }, 'Crawling Reddit');

  // Crawl
  const { posts, searchesRun } = await crawl(vertical, customTopics);
  logger.info({ posts: posts.length, searches: searchesRun }, 'Crawl complete');

  // Analyze
  const insights = await analyze(posts, vertical, customTopics);
  const insightsCount = (insights.themes?.length || 0) + (insights.pain_points?.length || 0);
  logger.info({ insightsCount }, 'Analysis complete');

  // Store
  const today = new Date().toISOString().split('T')[0];

  // Delete any existing report for today (allows re-runs during testing)
  await ops.from('intelligence_reports').delete()
    .eq('professional_id', professionalId)
    .eq('report_date', today);

  const { data: report } = await ops
    .from('intelligence_reports')
    .insert({
      professional_id: professionalId,
      vertical,
      report_date: today,
      posts_crawled: posts.length,
      insights_count: insightsCount,
      report_content: insights,
    })
    .select('id, report_date, posts_crawled, insights_count, report_content')
    .single();

  logger.info({ reportId: report?.id }, 'Intelligence report stored');
  return report;
}
