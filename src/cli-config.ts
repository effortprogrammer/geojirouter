export function requireLoopbackHost(host: string): "127.0.0.1" {
  if (host !== "127.0.0.1") {
    throw new Error("Gateway only supports the loopback host 127.0.0.1");
  }
  return host;
}

export function requireGatewayToken(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("GATEWAY_TOKEN must be explicitly configured");
  }
  return value;
}
