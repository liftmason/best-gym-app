from .local import *  # noqa: F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Email Message-IDs look up this machine's full host name, which can take ~30 s on some
# networks (audit T6). Give Django a fixed name instead.
from django.core.mail.utils import DNS_NAME  # noqa: E402

DNS_NAME._fqdn = "testserver"

PUSH_PROVIDER = "memory"  # apps.signin.push.outbox
