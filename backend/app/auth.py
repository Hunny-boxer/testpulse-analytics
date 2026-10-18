"""Supabase access-token verification for TestPulse API."""

import os
from typing import Any

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
) -> dict[str, str]:
    """Validate a bearer token and return the verified user identity."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")

    if not supabase_url or not publishable_key:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is not configured.",
        )

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={
                    "apikey": publishable_key,
                    "Authorization": f"Bearer {credentials.credentials}",
                },
            )
    except httpx.RequestError:
        raise HTTPException(
            status_code=503,
            detail="Authentication service is temporarily unavailable.",
        ) from None

    if response.status_code in (400, 401, 403):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not response.is_success:
        raise HTTPException(
            status_code=503,
            detail="Could not verify the access token.",
        )

    try:
        user: Any = response.json()
    except ValueError:
        raise HTTPException(
            status_code=503,
            detail="Authentication service returned an invalid response.",
        ) from None

    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        raise HTTPException(
            status_code=401,
            detail="Invalid user identity.",
        )

    email = user.get("email")
    return {
        "id": user["id"],
        "email": email if isinstance(email, str) else "",
    }
