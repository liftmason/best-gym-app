class EmptyJsonIsNullMiddleware:
    """Gives JSON answers with no body the body `null`, which is valid JSON.

    Render's edge (Cloudflare) compresses responses. An empty body compresses to one byte of
    Brotli and goes out with Content-Length: 1. Browsers decode it back to nothing, but the
    app's API client (openapi-fetch) trusts the length and parses the nothing as JSON, so
    every empty answer ("code sent", "saved") failed. `null` survives any encoding. (Asking
    the edge not to compress, with Cache-Control: no-transform, was tried: it's ignored.)
    A 204 stays empty: it may not have a body, and the client never reads one.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            response.status_code != 204
            and not getattr(response, "streaming", False)
            and not response.content
            and response.get("Content-Type", "").startswith("application/json")
        ):
            response.content = b"null"
            response["Content-Length"] = str(len(response.content))
        return response
