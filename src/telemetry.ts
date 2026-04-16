/**
 * Telemetry helpers for custom spans and metrics.
 * Uses the OTel API — returns no-ops when SDK is not initialized.
 */
import { trace, metrics, SpanStatusCode, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('claudeclaw-slack-bot', '1.0.0');
const meter = metrics.getMeter('claudeclaw-slack-bot', '1.0.0');

// Metrics
// Note: unit names are already embedded in metric names — do NOT set the `unit`
// field, or OTLP-to-Prometheus conversion will double-suffix them.
export const queryCostHistogram = meter.createHistogram('claudeclaw.slack.query_cost_usd', {
  description: 'Cost of Claude SDK queries in USD',
});

export const queryDurationHistogram = meter.createHistogram('claudeclaw.slack.query_duration_ms', {
  description: 'Duration of Claude SDK queries in milliseconds',
});

export const queryCounter = meter.createCounter('claudeclaw.slack.query_count', {
  description: 'Number of Claude SDK queries by channel',
});

export const errorCounter = meter.createCounter('claudeclaw.slack.error_count', {
  description: 'Number of errors during query processing',
});

// Token metrics — broken down by channel so we can identify what's consuming tokens
export const inputTokensHistogram = meter.createHistogram('claudeclaw.slack.input_tokens', {
  description: 'Input tokens per query',
});

export const outputTokensHistogram = meter.createHistogram('claudeclaw.slack.output_tokens', {
  description: 'Output tokens per query',
});

export const cacheReadTokensHistogram = meter.createHistogram('claudeclaw.slack.cache_read_tokens', {
  description: 'Cache read tokens per query',
});

export const cacheCreationTokensHistogram = meter.createHistogram('claudeclaw.slack.cache_creation_tokens', {
  description: 'Cache creation tokens per query',
});

/**
 * Attributes to record after a query completes.
 */
export interface QuerySpanResult {
  cost_usd?: number;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  is_error?: boolean;
}

/**
 * Wraps a Claude SDK query with OTel span + metrics.
 *
 * Creates a span named `slack.query`, records initial attributes,
 * then after the wrapped function resolves, sets result attributes
 * and records cost/duration metrics.
 */
export async function withQuerySpan<T>(
  attributes: {
    channel_id: string;
    thread_ts?: string;
    user_id: string;
    engine?: 'claude' | 'copilot';
  },
  fn: (span: Span) => Promise<T & { _telemetry?: QuerySpanResult }>
): Promise<T> {
  return tracer.startActiveSpan('slack.query', async (span) => {
    const start = Date.now();
    try {
      span.setAttributes({
        'slack.channel_id': attributes.channel_id,
        'slack.user_id': attributes.user_id,
        'query.engine': attributes.engine ?? 'claude',
      });
      if (attributes.thread_ts) {
        span.setAttribute('slack.thread_ts', attributes.thread_ts);
      }

      queryCounter.add(1, { channel_id: attributes.channel_id });

      const result = await fn(span);

      // Extract telemetry data if provided
      const telemetry = (result as any)?._telemetry as QuerySpanResult | undefined;
      if (telemetry) {
        if (telemetry.cost_usd !== undefined) {
          span.setAttribute('query.cost_usd', telemetry.cost_usd);
          queryCostHistogram.record(telemetry.cost_usd, { channel_id: attributes.channel_id });
        }
        if (telemetry.duration_ms !== undefined) {
          span.setAttribute('query.duration_ms', telemetry.duration_ms);
          queryDurationHistogram.record(telemetry.duration_ms, { channel_id: attributes.channel_id });
        }
        if (telemetry.input_tokens !== undefined) {
          span.setAttribute('query.input_tokens', telemetry.input_tokens);
          inputTokensHistogram.record(telemetry.input_tokens, { channel_id: attributes.channel_id });
        }
        if (telemetry.output_tokens !== undefined) {
          span.setAttribute('query.output_tokens', telemetry.output_tokens);
          outputTokensHistogram.record(telemetry.output_tokens, { channel_id: attributes.channel_id });
        }
        if (telemetry.cache_read_tokens !== undefined) {
          span.setAttribute('query.cache_read_tokens', telemetry.cache_read_tokens);
          cacheReadTokensHistogram.record(telemetry.cache_read_tokens, { channel_id: attributes.channel_id });
        }
        if (telemetry.cache_creation_tokens !== undefined) {
          span.setAttribute('query.cache_creation_tokens', telemetry.cache_creation_tokens);
          cacheCreationTokensHistogram.record(telemetry.cache_creation_tokens, { channel_id: attributes.channel_id });
        }
        if (telemetry.is_error) {
          errorCounter.add(1, { channel_id: attributes.channel_id });
        }

        // Clean up the _telemetry field from the result
        delete (result as any)._telemetry;
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      errorCounter.add(1, { channel_id: attributes.channel_id });
      throw err;
    } finally {
      const wallDuration = Date.now() - start;
      span.setAttribute('wall_duration_ms', wallDuration);
      span.end();
    }
  });
}
