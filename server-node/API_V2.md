# Identity3D v2 API

`POST /v2/jobs` accepts multipart `images` (one to four files) and a `preset`
(`preview`, `production`, or `rigged`). It returns HTTP 202 and a job id.

Poll `GET /v2/jobs/:id`, then download the GLB from
`GET /v2/jobs/:id/result` after `status=complete`. Status responses include the
mesh quality report and explicit backend capabilities.

Multi-view geometry fusion, rigging and blendshapes remain `false` until the
corresponding project-owned training checkpoints are installed. The upload and
job contracts already support these later stages. Legacy `POST /generate`
clients remain compatible.
