#!/usr/bin/env python3
import urllib.request, json, os, sys

TOKEN = "16ab5912-a3f7-488c-9d99-6fa9cbfefa95"
URL = "https://api.railway.app/graphql/v2"
PROJECT = "ed6daecd-dfdb-4b2f-ac39-8a662263330a"
APP = "4b948234-e4a0-4509-be61-525e8ce97235"
ENV = "b2a58f68-a0cc-4e72-a674-da7f343d12ac"

def gql(q, v=None):
    body = {"query": q}
    if v: body["variables"] = v
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}

# List deployments for the app service
res = gql("""
query($input: DeploymentListInput!) {
  deployments(first: 5, input: $input) {
    edges { node { id status createdAt url meta { description } } }
  }
}
""", {"input": {"projectId": PROJECT, "serviceId": APP, "environmentId": ENV}})

print("=== Recent deployments ===")
print(json.dumps(res, indent=2))
