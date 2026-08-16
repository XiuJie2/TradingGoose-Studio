/**
 * OpenAI-compatible base URL for MiniMax. The international host is the default;
 * mainland-China accounts are issued keys for `https://api.minimaxi.com/v1`
 * instead, which is why this is an operator-editable setting rather than a
 * constant baked into the provider.
 */
export const MINIMAX_API_BASE_URL_DEFAULT = 'https://api.minimax.io/v1'
