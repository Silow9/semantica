"""In-process embed of the RAGFlow file-parser contract.

See NOTICE in this directory. ``parse_bytes`` is the only entry the
Explorer routes call.
"""

from .parse import parse_bytes

__all__ = ["parse_bytes"]
