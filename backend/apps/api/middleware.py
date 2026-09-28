from django.utils.cache import patch_cache_control


class KeepEmptyAnswersEmptyMiddleware:
    """Marks answers with no body `Cache-Control: no-transform`, so proxies leave them alone.

    Render's edge (Cloudflare) compresses responses. An empty body compresses to one byte of
    Brotli (about twenty of gzip) and goes out with that as its Content-Length. Browsers
    decode it back to nothing, but the app's API client (openapi-fetch) trusts the length and
    tries to parse the nothing as JSON, so every empty answer ("code sent", "saved") failed.
    no-transform is the standard way to ask a proxy not to re-encode a response.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not getattr(response, "streaming", False) and not response.content:
            patch_cache_control(response, no_transform=True)
        return response
