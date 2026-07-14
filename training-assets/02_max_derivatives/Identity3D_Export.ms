/* Identity3D controlled 3ds Max export recipe
   Run inside a licensed 3ds Max worker.  The worker must save the scene first,
   then export only normalized derivatives; never overwrite 01_source_archives.
*/

global identity3dRoot = (getFilenamePath maxFilePath) + "..\\03_normalized_scene\\"
global identity3dSample = (getFilenameFile maxFilePath)

fn ensureDir p = (if not (doesFileExist p) then makeDir p all:true)

fn normalizeScene =
(
    resetXForm selection
    for o in geometry do (
        if o.parent == undefined then o.position = [0,0,0]
    )
    units.SystemType = #Meters
    for o in geometry do (
        if isProperty o #scale then o.scale = [1,1,1]
    )
    max modify mode
)

fn exportIdentityDerivative =
(
    ensureDir identity3dRoot
    normalizeScene()
    local out = identity3dRoot + identity3dSample + ".fbx"
    exportFile out #noPrompt selectedOnly:false using:FBXEXP
    format "Identity3D exported: %\n" out
)

exportIdentityDerivative()
