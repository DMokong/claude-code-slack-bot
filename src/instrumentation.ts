/**
 * OpenTelemetry instrumentation for the Claude Code Slack Bot.
 * MUST be imported before any other module to enable auto-instrumentation.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const otelEnabled = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | null = null;

if (otelEnabled) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'claudeclaw-slack-bot',
      [ATTR_SERVICE_VERSION]: '1.0.0',
      'deployment.environment': process.env.OTEL_RESOURCE_ATTRIBUTES?.includes('production') ? 'production' : 'development',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 60_000,
    }),
    instrumentations: [
      new HttpInstrumentation(),
    ],
  });

  sdk.start();
  console.error('OTel initialized — Slack Bot telemetry active');

  // Graceful shutdown
  process.on('SIGTERM', () => sdk?.shutdown());
  process.on('SIGINT', () => sdk?.shutdown());
} else {
  console.error('OTel disabled — OTEL_EXPORTER_OTLP_ENDPOINT not set');
}

export { sdk };
