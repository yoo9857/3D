---
license: cc-by-4.0
task_categories:
- keypoint-detection
- image-classification
- text-to-3d
- image-to-3d
- other
language:
- en
tags:
- 3d-models
- human-scans
- poses
- computer-vision
- machine-learning
- 3d
- human-pose
- demographics
- photogrammetry
- reality-capture
size_categories:
- 1K<n<10K
configs:
- config_name: default
  data_files: manifest/persons.jsonl manifest/poses.jsonl manifest/files.parquet
pretty_name: 'HSRD-100: 100 High-Quality 3D Human Scans Dataset'
---

# HSRD-100: 100 High-Quality 3D Human Scans Dataset from HumanScanRepository

## Dataset Summary
**HSRD-100** is a comprehensive 3D human scan dataset featuring 100 high-quality poses from 10 diverse individuals. This dataset provides a balanced representation of human demographics and poses, making it ideal for computer vision, machine learning, and 3D modeling applications.

![HSRD-100-header.jpg](https://cdn-uploads.huggingface.co/production/uploads/68cbe13a65b8bcb65d48618d/hBZLaTgvsnprlyAOTpDeO.jpeg)

## Dataset Details

### Dataset Description
- **Homepage**: [https://huggingface.co/datasets/digitalrealitylab/HSRD-100](https://huggingface.co/datasets/digitalrealitylab/HSRD-100)
- **Repository**: [digitalrealitylab/HSRD-100](https://huggingface.co/datasets/digitalrealitylab/HSRD-100)
- **Point of Contact**: DigitalRealityLab

### Dataset Statistics
- **Total Poses**: 100
- **Unique Individuals**: 10
- **Poses per Person**: 10
- **Age Range**: 21-64 years
- **Gender Distribution**: 50% Male, 50% Female
- **Ethnicity Distribution**: 
  - Caucasian: 30%
  - African: 30%
  - Hispanic: 20%
  - Asian: 20%

## Dataset Structure

### Data Instances
Each data instance contains:
- **3D Model Files**: Multiple LOD (Level of Detail) versions
  - `{PoseID}-Scan.zip`: High-resolution original scan at 5 mil polygons and 16k texture
  - `{PoseID}-Scan-LOD0.zip`: Highest quality mesh at 1 mil polygons and 16k texture
  - `{PoseID}-Scan-LOD1.zip`: Medium quality mesh at 100k polygons and 8k texture
  - `{PoseID}-Scan-LOD2.zip`: Lower quality mesh for performance at 10k polygons and 4k texture
- **Source Files**:
  - `{PoseID}-RealityCapture.zip`: Source photogrammetry data used for computation
  - `{PoseID}-Photos.zip`: Source photographs used for scanning rig with high-res 112 cameras
- **Metadata Files**:
  - `person_meta.json`: Individual demographic information. For more information [Metadata Guide](https://humanscanrepository.com/metadata-guide/)
  - `pose_meta.json`: Pose-specific metadata. For more information [Metadata Guide](https://humanscanrepository.com/metadata-guide/)
- **Preview Images**:
  - `{PoseID}-Cover.jpg`: Beauty image for dataset browsing (located in preview/ folder) with 4 sides of views of the scan.

### Data Fields
- **Person ID**: Unique identifier for each individual
- **Pose ID**: Unique identifier for each pose
- **Demographics**: Age, sex, ethnicity, height, weight etc.
- **Pose Information**: Pose type, activity, clothing style etc.
- **Technical Data**: File paths, scan parameters, quality metrics

### Data Splits
The dataset is organized by person and pose:
- **Person-based organization**: 10 individuals with 10 poses each
- **Pose diversity**: Various standing, walking, and activity poses
- **Clothing variety**: Casual, business, formal, and activewear

## Dataset Creation

### Curation Rationale
This dataset was created to provide a balanced representation of human diversity in 3D scanning applications. The selection criteria included:
- **Demographic balance**: Equal gender representation and diverse ethnicities
- **Age diversity**: Representation across adult age ranges
- **Pose variety**: Natural human poses and activities
- **Clothing diversity**: Various styles and contexts

### Source Data
- **3D Scanning**: Professional high-end 3D scanning equipment
- **Photogrammetry**: RealityCapture software for 3D reconstruction
- **Quality Control**: Consistent lighting and capture conditions
- **Post-processing**: Professional optimization and LOD generation

### Preprocessing
- **File Organization**: Structured by Person ID and Pose ID
- **LOD Generation**: Multiple quality levels for different use cases
- **Metadata Extraction**: Comprehensive demographic and technical data
- **Preview Generation**: Beauty images for dataset browsing

## Uses

### Direct Use
This dataset can be used directly for:
- **3D Character Modeling**: Reference poses for character creation
- **Pose Estimation Training**: Training data for pose recognition models
- **Demographic Analysis**: Studies on human representation in 3D data
- **Animation Reference**: Pose libraries for animation workflows

### Downstream Use
Potential downstream applications include:
- **Computer Vision**: Human pose estimation, activity recognition
- **Machine Learning**: Training models for human behavior analysis
- **Virtual Reality**: Avatar creation and pose libraries
- **Research**: Human-computer interaction, accessibility studies

### Out-of-Scope Use
This dataset should not be used for:
- **Biometric identification**: Not designed for person identification
- **Medical diagnosis**: Not intended for medical applications
- **Surveillance**: Not suitable for surveillance or tracking purposes

## Data Considerations

### Potential Biases
- **Geographic bias**: Scans may be limited to specific geographic regions
- **Cultural bias**: Clothing and pose choices may reflect specific cultural contexts
- **Temporal bias**: Data collected at a specific time period
- **Equipment bias**: All scans use the same scanning equipment and setup

### Known Limitations
- **Sample size**: Limited to 100 poses from 10 individuals
- **Pose variety**: May not cover all possible human poses
- **Demographic representation**: While diverse, may not represent all populations
- **Temporal factors**: Clothing and styles may become dated over time

### Ethical Considerations
- **Consent**: All participants provided informed consent for data collection
- **Privacy**: Personal identifiers have been removed from the dataset
- **Representation**: Efforts made to include diverse demographics
- **Responsible use**: Dataset intended for research and development purposes

## Technical Specifications

### 3D Model Quality
- **Format**: OBJ (Wavefront OBJ)
- **Average Polycount**: 5,000,000 polygons per model
- **Texture Format**: PNG
- **Texture Resolution**: 16,384 pixels (4K+ resolution)
- **File Structure**: Organized by Person ID and Pose ID

### File Organization
```
HSRD-100/
├── manifest/
│   ├── persons.jsonl          # Person metadata
│   ├── poses.jsonl            # Pose metadata
│   └── files.parquet          # File inventory
├── preview/                   # Thumbnail images
│   └── {PoseID}-Cover.jpg
└── data/                      # 3D model files
    └── {PersonID}/{PoseID}/
        ├── {PoseID}-Scan.zip
        ├── {PoseID}-Scan-LOD0.zip
        ├── {PoseID}-Scan-LOD1.zip
        ├── {PoseID}-Scan-LOD2.zip
        ├── {PoseID}-RealityCapture.zip
        └── {PoseID}-Photos.zip
```

### Preview Images
- **Location**: `preview/` folder (singular)
- **Naming**: `{PoseID}-Cover.jpg` (e.g., `HSR0027-Body-006-Cover.jpg`)
- **Source**: Beauty images from the original scan folders (`Scan/` subfolder)
- **Purpose**: Thumbnail images for dataset browsing and preview
- **Format**: JPG images with high quality for visual identification

## Citation

```bibtex
@dataset{HSRD-100_2025,
  title={HSRD-100: 100 High-Quality 3D Human Scans Dataset},
  author={Digital Reality Lab},
  year={2025},
  url={https://huggingface.co/datasets/digitalrealitylab/HSRD-100},
  license={cc-by-4.0}
}
```

## License

This dataset is licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

### What this means:
- ✅ **Commercial use allowed** - Companies can use this dataset in commercial products
- ✅ **Personal use allowed** - Individuals can use it for personal projects
- ✅ **Modification allowed** - Users can modify and adapt the dataset
- ✅ **Distribution allowed** - Users can share and redistribute the dataset
- 📝 **Attribution required** - Users must give appropriate credit and cite the dataset
- 🔗 **Link to license** - Users must provide a link to the license
- ⚠️ **No additional restrictions** - Users cannot apply additional restrictions

## Contact

For questions about this dataset, please contact [Digital Reality Lab](https://www.digitalrealitylab.com/) or open an issue in the repository. If you are looking for larger dataset with 3d human scans and models check out our personal repository [HumanScanRepository](https://humanscanrepository.com/).

---

*This dataset represents a carefully curated collection of 3D human scans designed to support diverse research and development needs in computer vision, machine learning, and 3D graphics.*