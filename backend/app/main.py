
import os

# Keep local development working, and allow approved deployment
# origins to be configured through the environment.
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "TESTPULSE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
