# Pre-undeploy snapshot of the original app (read-only, no secret values)

Captured 2026-11-20T20:59:10Z. Original app `app_01M7TZWJD321CGWEMJGK49RB8C`, https://dealproof.app.space, repo https://github.com/ModiCodie/dealproof at commit `7304826f9bb8a4dc2dbbae55818bf3bc3d23df02`. Support report `8d11d4c4-e418-40eb-9912-3348a9cef234`.

A Git bundle of the original repository (all refs, 14 commits) was saved outside both projects as `dealproof-original-7304826.bundle` and verified.

## `deepspace status --json`
```
{"ok":true,"env":"production","services":{"auth":"https://auth.deep.space","api":"https://api-worker.deep.space","platform":"https://platform-worker.deep.space","deploy":"https://deploy-worker.deep.space"},"loggedIn":true,"user":"<email>","inApp":true,"appName":"dealproof","appId":"app_01M7TZWJD321CGWEMJGK49RB8C","deps":"ready","branch":"main","workspaceId":null,"dirtyFiles":0,"source":{"provider":"github","repository":"modicodie/dealproof","revision":1},"trunk":{"state":"external","provider":"github","branch":"main","isTrunk":null},"live":null}
```

## `deepspace app source --json`
```
{"ok":true,"appId":"app_01M7TZWJD321CGWEMJGK49RB8C","source":{"provider":"github","repository":"modicodie/dealproof"},"revision":1,"registered":true}
```

## `deepspace releases --json`
```
{"ok":true,"appId":"app_01M7TZWJD321CGWEMJGK49RB8C","wranglerEnv":null,"releases":[]}
```

## `deepspace activity --json`
```
{"ok":true,"events":[],"cursor":0,"hasMore":false}
```

## `deepspace logs --since 24h --json`
```
{"ok":false,"code":"app_not_deployed","error":"app_01M7TZWJD321CGWEMJGK49RB8C has never been deployed, so it has no logs. Deploy it first (`deepspace deploy`), then read its logs.","action":{"cwd":"/Users/modiwu/Desktop/cmu/DeepSpace-Project","argv":["/Users/modiwu/.local/node24/node_modules/node/bin/node","/Users/modiwu/Desktop/cmu/DeepSpace-Project/node_modules/deepspace/dist/cli.js","deploy"]}}
```

## `deepspace app list --json`
```
{"ok":true,"apps":[{"appId":"app_01M7TZWJD321CGWEMJGK49RB8C","ownerUserId":"GrRWjxBvXmO6INaPx2oFFTw6NzZU6GEe","status":"active","hasSecretsStore":true,"createdAt":"2026-11-19T22:47:25.362Z","deployedAt":null,"source":{"provider":"github","repository":"modicodie/dealproof"},"sourceRevision":1,"routes":[{"host":"dealproof.app.space","appId":"app_01M7TZWJD321CGWEMJGK49RB8C","kind":"subdomain","status":"active","claimedAt":"2026-11-19T22:54:18.431Z","releasedAt":null,"releasedBy":null}],"role":"owner","name":"dealproof","url":"https://dealproof.app.space","reservedName":null,"reservedUntil":null}],"pendingTransfers":[]}
```

## `deepspace secrets list`
```
PRICESAPI_KEY  (v1, 2026-11-19T22:49:41.224Z)
```

## `deepspace app files list`
```
No files. Upload one with `deepspace app files put <file>`.
Storage: 0 B of 1.0 GiB used
```

## Public release marker and assets
```
HTTP/2 200 
etag: "c4f90e24d1d0c0d0f857a3e62217d57b"
{"release":"8c07d69a-b063-4867-ad79-38ba039e40f5"}
assets/index-BeHadXul.js sha256=828f4edc3ce95dbd5d1a78af6dc92edb51cdd8de98edbd910b26e8d8ade083ee
assets/index-DM_xp8dV.css sha256=7c5ef586f9b6bc3eff790d819d433dd9c006f0a35b8bddf09196095dd96353d3
```

Earlier finding (docs/deployment-forensics.md): these asset hashes equal a local build of commit 57be8bf, the first deployed commit.

## Undeploy attempt (run by the project owner in their own terminal, 2026-11-20, about 21:1x UTC)

Command: `npx deepspace app undeploy app_01M7TZWJD321CGWEMJGK49RB8C`, answered Yes at the interactive prompt.
Result: `Failed` — `Another release operation is already activating for this app [script_operation_in_progress]`.
The code `script_operation_in_progress` appears nowhere in the current docs corpus (llms-full.txt, 0 matches), the installed CLI 0.44.2, or its CHANGELOG, so it is server-side only.
State re-checked read-only at 2026-11-20T21:16Z: app still `status: active`, `deployedAt: null`, route `dealproof.app.space` active, 0 releases, 0 events, public marker unchanged (`8c07d69a-b063-4867-ad79-38ba039e40f5`). The free-plan slot is therefore still held. No retry was made.
