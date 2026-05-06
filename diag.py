#!/usr/bin/env python3
import urllib.request, json

TOKEN = "16ab5912-a3f7-488c-9d99-6fa9cbfefa95"
URL = "https://api.railway.app/graphql/v2"
PROJECT = "ed6daecd-dfdb-4b2f-ac39-8a662263330a"
APP = "4b948234-e4a0-4509-be61-525e8ce97235"
PG = "1a99f491-1185-446a-8999-ed57357af682"
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

# 1. Get app service env vars
print("=== APP ENV VARS ===")
res = gql("query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}",
    {"p":PROJECT,"e":ENV,"s":APP})
if "data" in res:
    for k,v in (res["data"]["variables"] or {}).items():
        if k in ("ANTHROPIC_API_KEY","GOOGLE_OAUTH_CLIENT_SECRET","GOOGLE_OAUTH_REFRESH_TOKEN"):
            print(f"  {k}: {v[:10]}... (masked)")
        else:
            print(f"  {k}: {v}")
else:
    print(res)

print()
print("=== POSTGRES ENV VARS ===")
res = gql("query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}",
    {"p":PROJECT,"e":ENV,"s":PG})
if "data" in res:
    for k,v in (res["data"]["variables"] or {}).items():
        if "PASSWORD" in k or "URL" in k:
            print(f"  {k}: {v[:30]}...")
        else:
            print(f"  {k}: {v}")
else:
    print(res)

print()
print("=== APP SERVICE INSTANCE ===")
res = gql("""query($i:String!){service(id:$i){id name serviceInstances{edges{node{id environmentId latestDeployment{id status createdAt url}}}}}}""",
    {"i":APP})
print(json.dumps(res, indent=2)[:2000])
