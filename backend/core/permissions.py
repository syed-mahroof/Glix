"""
backend/core/permissions.py

Object-level permission helpers layered on top of IsAuthenticated
(the project-wide default in settings.REST_FRAMEWORK). Every current
endpoint does its per-object ownership check ad hoc inline instead
(e.g. get_object_or_404(Model, pk=pk, user=request.user)) — no shared
helper is in use yet, so none is defined here right now.
"""