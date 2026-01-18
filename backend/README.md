# setup
```sh
# install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# initial setup
cd backend/
uv sync
uv run agent.py download-files

# run the agent
uv run agent.py
```
