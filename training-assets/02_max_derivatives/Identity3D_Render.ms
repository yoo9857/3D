/* Identity3D supervision render pass recipe.
   Execute after Identity3D_Export.ms in a licensed 3ds Max worker.
   Render output is deliberately split by pass; never train from beauty RGB
   alone because depth/normal/IDs are required for geometry supervision.
*/
global identity3dRenderRoot = (getFilenamePath maxFilePath) + "..\\04_supervision\\"
global identity3dSample = (getFilenameFile maxFilePath)

fn ensureDir p = (if not (doesFileExist p) then makeDir p all:true)
fn passDir name = (identity3dRenderRoot + name + "\\" + identity3dSample + "\\")

fn setupCamera azimuth elevation distance =
(
    local cam = FreeCamera name:("Identity3D_Camera_" + (azimuth as string))
    cam.position = [distance * sin azimuth, -distance * cos azimuth, distance * sin elevation]
    cam.target = [0,0,1]
    cam
)

fn renderPass passName cameraRef fileType =
(
    local dir = passDir passName
    ensureDir dir
    render camera:cameraRef outputfile:(dir + "000." + fileType) vfb:false
)

-- Standardized orbit: front/back/left/right plus elevated views.
local cameras = #()
for angle in #(0, 90, 180, 270) do append cameras (setupCamera angle 0 3.0)
append cameras (setupCamera 45 25 3.0)
append cameras (setupCamera 225 25 3.0)

for cam in cameras do (
    renderPass "rgb" cam "png"
    -- Production worker should swap these materials/render elements:
    -- depth: linear Z EXR, normal: world-space XYZ EXR, segmentation/material_id: PNG IDs.
    renderPass "depth" cam "exr"
    renderPass "normal" cam "exr"
    renderPass "segmentation" cam "png"
    renderPass "material_id" cam "png"
    delete cam
)
format "Identity3D supervision renders complete: %\n" identity3dSample
