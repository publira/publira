import { describe, expect, it } from "vitest";

import {
  deploymentEnvironment,
  ENVIRONMENT_DEVELOPMENT,
  isTracingEnabled,
  PRODUCTION_SAMPLE_RATIO,
  rootSampling,
} from "./config.js";

describe("isTracingEnabled", () => {
  it.each(["true", "TRUE", "True", "1", "t", " true "])(
    "reads %j as enabled",
    (value) => {
      expect(isTracingEnabled({ PUBLIRA_TRACING_ENABLED: value })).toBe(true);
    }
  );

  it.each([undefined, "", "false", "0", "yes", "on"])(
    "reads %j as disabled",
    (value) => {
      expect(isTracingEnabled({ PUBLIRA_TRACING_ENABLED: value })).toBe(false);
    }
  );
});

describe("deploymentEnvironment", () => {
  it("defaults to development", () => {
    expect(deploymentEnvironment({})).toBe(ENVIRONMENT_DEVELOPMENT);
  });

  it("lowercases the declared tier", () => {
    expect(
      deploymentEnvironment({ PUBLIRA_DEPLOYMENT_ENVIRONMENT: "Production" })
    ).toBe("production");
  });
});

describe("rootSampling", () => {
  it("samples every root span in development", () => {
    expect(rootSampling({})).toEqual({ kind: "always_on" });
  });

  it("samples a share of root spans outside development", () => {
    expect(
      rootSampling({ PUBLIRA_DEPLOYMENT_ENVIRONMENT: "production" })
    ).toEqual({ kind: "ratio", ratio: PRODUCTION_SAMPLE_RATIO });
  });

  it("leaves sampling to the SDK once the operator sets OTEL_TRACES_SAMPLER", () => {
    expect(
      rootSampling({
        OTEL_TRACES_SAMPLER: "always_on",
        PUBLIRA_DEPLOYMENT_ENVIRONMENT: "production",
      })
    ).toEqual({ kind: "operator" });
  });
});
