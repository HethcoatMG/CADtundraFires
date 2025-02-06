/**
 * 2023-12-20
 *
 * much of the existing code base here is written by Luka Rogic
 * MGH updated and modified sections for the tundra
 * updates included:
 *   - moving to Landsat C2
 *   - adding L4, L5 (as C2)
 *   - updating L7, L8 to C2 (cloud mask, scale factors, band names, etc) 
 *   - removed S2 b/c it affected RF probabilities (need to look into Landsat-S2 harmonized dataset)
 *   - removed pre- variables (added post-values but not incorporated to model)
 *   - added in training data further back in time (1985-2020)
 *   - hard coded the search query to June15-Aug31 (instead of MODIS snow free search)
 * 
 *  PLEASE CITE THE FOLLOWING PAPER:
 *  Hethcoat et al. 2024. Unrecorded tundra fires in Canada 1986–2022. Remote Sensing 
 */




var allVars = ['RBR', 'RdNBR', 'dNBR', 'dNBR2', 'dNDVI','dNDMI', 'dNDWI', 'dEVI', 'dMIRBI',
               'dBAI', 'dBAIMs', 'dCSI', 'dBSI',  'dMSAVI', 'dTCB', 'dTCG', 'dTCW'];

var predictorVariables = [ 'dNBR2', 'dTCG', 'dTCB' ];
var allVariables = ['nbr','nbr2','ndvi','ndmi','ndwi','evi','mirbi',
                    'bai', 'baims','csi','bsi','msavi','tcb','tcg','tcw'];




// **********************************************************************************************************************
// User interface (panel left)
// **********************************************************************************************************************
Map.style().set('cursor', 'hand');
Map.drawingTools().setDrawModes(["rectangle"]);
Map.setOptions('TERRAIN'); 
Map.setCenter(-120, 65, 6);


var panel = ui.Panel();
panel.style().set({
  width: '400px',
  border : '1px solid 000000',
  backgroundColor : 'FFFFFF'
});


var label_year_selection = ui.Label({
  value:'Select year of analysis (1985 - 2023):', 
  style:{color: '000000', 
    backgroundColor:'FFFFFF', 
    fontWeight:'bold'}
});
var year_selection = ui.Slider({
  min: 1985,
  max: 2023, 
  value: 2023, 
  step: 1,
  onChange: function(value) {
    var year_selection = value;
  },
  style: {width: '380px',color: '000000', backgroundColor:'FFFFFF', fontWeight:'bold'}
});


var runButton = ui.Button({
  label: 'RUN'
});


var ROI_selection = ui.Checkbox({
  label: 'Draw polygon (instead of default ROI)',  
  value: true,
  style: {color: '000000', backgroundColor:'FFFFFF', fontWeight:'bold'},
  onChange: function(value) {
    var ROI_selection = value;
  }
});


var Download_selection = ui.Checkbox({
  label: 'Check to export vectors',  
  value: false,
  style: {color: '000000', backgroundColor:'FFFFFF', fontWeight:'bold'},
  onChange: function(value) {
    var Download_selection = value;
  }
});


var blankBig = ui.Label({value:'__________________', style:{color: 'FFFFFF', backgroundColor:'FFFFFF', fontSize: '20px', textAlign: 'left'}});


panel.add(label_year_selection);
panel.add(year_selection);
panel.add(blankBig);
panel.add(Download_selection);
panel.add(ROI_selection);
panel.add(runButton);

ui.root.insert(0,panel);
// ------------------------------------------------------------------------------------------------------------------
// end  User interface (panel left)




/*******************************************************************************
* Functions *
*
* A section to define functions used on your data later and needed in the app.
*
******************************************************************************/

/*
  Description: Calculate Enhanced Vegetation Index
  Formula Link: https://www.sciencedirect.com/science/article/pii/S0034425702000962 (Equation 2)
  Inputs: 
    -img: landsat img
    -nir: near infrared band name
    -red: red band name
    -blue: blue band name
  Output: image with EVI calculated band
*/
var getEVI = function(img) {
  var result = img.expression(
    '(2.5 * ((NIR - RED) / (NIR + (6 * RED) - (7.5 * BLUE) + 1)))',
    {
      'NIR': img.select('nir'),
      'RED': img.select('red'),
      'BLUE': img.select('blue')
    }).toFloat();
    return ee.Image(result).select([0], ['evi']);
};

/*
  Description: Calculate Mid-Infrared Burn Index
  Formula Link: https://www.mdpi.com/2072-4292/10/8/1196 (Table 2)
  Inputs: 
    -img: landsat img
    -sswir: (shorter) shortwave infrared 1 (SWIR1)
    -lswir: (longer) shortwave infrared 2 (SWIR2)
  Output: image with MIRBI calculated band
*/
var getMIRBI = function(img) {
  var result = img.expression(
    '((10 * lSWIR) - (9.8 * sSWIR) + 2)',
    {
      'lSWIR': img.select('lswir'),
      'sSWIR': img.select('sswir')
    }).toFloat();
    return ee.Image(result).select([0], ['mirbi']);
};

/*
  Description: Calculate Burned Area Index
  Formula Link: https://www.mdpi.com/2072-4292/10/8/1196 (Table 2)
  Inputs: 
    -img: landsat img
    -nir: near infrared band name
    -red: red band name
  Output: image with BAI calculated band
*/
var getBAI = function(img) {
  var result = img.expression(
    '1/((0.1 - RED)**2 + (0.06 - NIR)**2)',
    {
      'RED': img.select('red'),
      'NIR': img.select('nir')
    }).toFloat();
    return ee.Image(result).select([0], ['bai']);
};

/*
  Description: Calculate Burned Area Index
  Formula Link: https://www.mdpi.com/2072-4292/10/8/1196 (Table 2)
  Inputs: 
    -img: landsat img
    -nir: near infrared band name
    -sswir: (shorter) shortwave infrared 1 (SWIR1)
  Output: image with BAIMs calculated band
*/
var getBAIMs = function(img) {
  var result = img.expression(
    '1/((NIR - 0.05 * NIR)**2 + (sSWIR - 0.2 * sSWIR)**2)',
    {
      'NIR': img.select('nir'),
      'sSWIR': img.select('sswir')
    }).toFloat();
    return ee.Image(result).select([0], ['baims']);
};

/*
  Description: Calculate Char Soil Index
  Formula Link: https://www.publish.csiro.au/wf/WF17069 (Table 2)
  Inputs: 
    -img: landsat img
    -nir: near infrared band name
    -sswir: (shorter) shortwave infrared 1 (SWIR1)
  Output: image with CSI calculated band
*/
var getCSI = function(img) {
  var result = img.expression(
    'NIR / sSWIR',
    {
      'NIR': img.select('nir'),
      'sSWIR': img.select('sswir')
    }).toFloat();
    return ee.Image(result).select([0], ['csi']);
};

/*
  Description: Calculate Bare Soil Index
  Formula Link: https://www.mdpi.com/2073-445X/10/3/231 (Table 1)
  Inputs: 
    -img: landsat img
    -red: red band name
    -sswir: (shorter) shortwave infrared 1 (SWIR1)
    -blue: blue band name
    -nir near infrared band name
  Output: image with BSI calculated band
*/
var getBSI = function(img) {
  var result = img.expression(
    '((RED + sSWIR) - (NIR + BLUE)) / ((RED + sSWIR) + (NIR + BLUE))',
    {
      'RED': img.select('red'),
      'sSWIR': img.select('sswir'),
      'BLUE': img.select('blue'),
      'NIR': img.select('nir')
    }).toFloat();
    return ee.Image(result).select([0], ['bsi']);
};

/*
  Description: Calculate Modified Soil Adjusted Vegetation Index
  Formula Link: https://www.sciencedirect.com/science/article/pii/0034425794901341 (Equation 19)
  Inputs: 
    -img: landsat img
    -nir: near infrared band name
    -red: red band name
  Output: image with MSAVI calculated band
*/
var getMSAVI = function(img) {
  var result = img.expression(
    '(2 * NIR + 1 - sqrt((2 * NIR + 1) ** 2 - 8 * (NIR - RED))) / 2',
    {
      'NIR': img.select('nir'),
      'RED': img.select('red')
    }).toFloat();
    return ee.Image(result).select([0], ['msavi']);
};

// - links to different papers tasselled cap greeness/wetness/brightness coeffcients 
// - currently using paper 3

// 1. https://www.researchgate.net/publication/237614492_Derivation_of_a_Tasseled_Cap_Transformation_Based_On_Landsat_7_At-Satellite_Reflectance
// 2. https://yceo.yale.edu/tasseled-cap-transform-landsat-8-oli
// 3. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0147121#pone.0147121.s001

// From paper 3: "Since data from all sensors were pre-preprocessed to surface reflectance products, 
// we used the same surface reflectance derived tasseled cap coefficients across all sensors"
// NOTE ALL SENSORS RECEIVED THE SAME COEFS (I.E. NOT SENSOR SPECIFIC)

/*
  Description: Calculate Tasselled Cap Indices
  Inputs: 
    -img: landsat img
    -blue: blue band name
    -green: green band name
    -red: red band name
    -nir: near infrared band name
    -sswir: (shorter) shortwave infrared 1 (SWIR1)
    -lswir: (longer) shortwave infrared 2 (SWIR2)
  Output: image with Tasselled Cap Brightness calculated band
*/
var getTCB = function(img) {
  var result = img.expression(
    '0.2043 * BLUE + 0.4158 * GREEN + 0.5524 * RED + 0.5741 * NIR + 0.3124 * sSWIR + 0.2303 * lSWIR',
    {
      'BLUE': img.select('blue'),
      'GREEN': img.select('green'),
      'RED': img.select('red'),
      'NIR': img.select('nir'),
      'sSWIR': img.select('sswir'),
      'lSWIR': img.select('lswir'),
    }).toFloat();
    return ee.Image(result).select([0], ['tcb']);
};


var getTCG = function(img) {
  var result = img.expression(
    '-0.1603 * BLUE - 0.2819 * GREEN - 0.4934 * RED + 0.7940 * NIR - 0.0002 * sSWIR - 0.1446 * lSWIR',
    {
      'BLUE': img.select('blue'),
      'GREEN': img.select('green'),
      'RED': img.select('red'),
      'NIR': img.select('nir'),
      'sSWIR': img.select('sswir'),
      'lSWIR': img.select('lswir'),
    }).toFloat();
    return ee.Image(result).select([0], ['tcg']);
};

var getTCW = function(img) {
  var result = img.expression(
    '0.0315 * BLUE + 0.2021 * GREEN + 0.3102 * RED + 0.1594 * NIR - 0.6806 * sSWIR - 0.6109 * lSWIR',
    {
      'BLUE': img.select('blue'),
      'GREEN': img.select('green'),
      'RED': img.select('red'),
      'NIR': img.select('nir'),
      'sSWIR': img.select('sswir'),
      'lSWIR': img.select('lswir'),
    }).toFloat();
    return ee.Image(result).select([0], ['tcw']);
};



// ------------------------------------------------------------------------------------------------------------------
// end all functions  



/*******************************************************************************
* 
* START OF MAIN SCRIPT *
*
********************************************************************************/

runButton.onClick( function() {
  
  ui.util.clear(); // clears errors or downloads in console/task (doesn't work)
  Map.clear();
  Map.setOptions('TERRAIN'); // TERRAIN, SATELLITE
  var ROI_select = ROI_selection.getValue();
  var Export_select = Download_selection.getValue();
  


  // train RF model used for prediction
  var data = ee.FeatureCollection('users/mghethcoat/NRCan/Luka_POINT_DATA');
  // best random forest hyperparameters determined by randomly searching
  // across hyperparameters for best accuracy
  var numberOfTrees = 100;
  var variablesPerSplit = null;
  var minLeafPopulation  = 1;
  var bagFraction = 0.7;
  var maxNodes = 560;
  var seed = 1;


  var classifier = ee.Classifier.smileRandomForest(
        {
          numberOfTrees: numberOfTrees,
          variablesPerSplit: variablesPerSplit,
          minLeafPopulation: minLeafPopulation,
          bagFraction: bagFraction,
          maxNodes: maxNodes,
          seed: seed
        }) 
      .train(data, 'BURNT', predictorVariables)
      .setOutputMode('PROBABILITY');



  // ****************************************
  // *****  IF/ELSE USING DRAWN POLY  *******
  // ***************************************
  
  if(ROI_select === true) {
    
    var features = Map.drawingTools().toFeatureCollection();
    var ROI = features;
    Map.centerObject(ROI);
    
    /** Clear Geometry Layers **/  
    //  https://gis.stackexchange.com/questions/372596/google-earth-engine-ui-select-callback-fires-recursively
    var myLayers = Map.drawingTools().layers();
    myLayers.get(0).geometries().remove(myLayers.get(0).geometries().get(0));
  }
  else if(ROI_select === false) {
    var ft = ee.FeatureCollection('users/mghethcoat/NRCan/northernEcozones_trueTundraSUB');

    var ROI = ee.FeatureCollection(ft);
    Map.centerObject(ROI);
  }


  var year_select = year_selection.getValue();
 
  // Definition of study area
  var studyarea = ROI;
  var opacity = 0.2;
  Map.addLayer(ROI, {}, "ROI", false, opacity);


// -------------------------------- Format bands and combine landsat collections ----------------------------

  /*
  Credit to:
  https://code.earthengine.google.com/b4fb68fb7f8f883595dbe165ff82e0d9
  https://code.earthengine.google.com/?scriptPath=users%2Flisamholsinger%2Fboreal_hybrid_severity%3Amanuscript
  */
  // Landsat 4,5,7,8,9 Surface Reflectance Collection 2 (Tier 1)
  var ls4SR = ee.ImageCollection("LANDSAT/LT04/C02/T1_L2").filterBounds(ROI); // 1982-1993  -  1982-08-22T14:19:55Z–1993-06-24T14:26:23
  var ls5SR = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2").filterBounds(ROI); // 1984-2012  -  1984-03-16T16:18:01Z–2012-05-05T17:54:06
  var ls7SR_OK = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").filterDate('1999-01-01', '2003-06-01').filterBounds(ROI); // 1999-pres  -  1999-05-28T01:02:17Z–
  var ls7SR_BAD = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2").filterDate('2003-06-01', '2033-01-01').filterBounds(ROI); // SLC error on June 1st 2003
  var ls8SR = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").filterBounds(ROI); // 2013-pres  -  2013-03-18T15:58:14Z– 
  var ls9SR = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").filterBounds(ROI); // 2021-pres  -  2021-10-31T00:00:00Z–


//--------------------------------------------- Format Landsat 8/9 -------------------------------------------
  // For easier translation from band description to band name
  var ls89Rename = function(lsImage) {
    var sub = lsImage.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7', 'QA_PIXEL'])
      .rename(['blue', 'green', 'red', 'nir', 'sswir', 'lswir', 'qa_pixel']);
  
    return sub.copyProperties(lsImage, ['system:time_start']);
  };
  // Conversion constants as specified by the dataset
  var scale = 0.0000275;
  var offset = -0.2;

/*
  Description: Converts landsat band value to proper scale and offset as described by dataset
  Input: lsImage: landsat image
  Output: landsat image with its band values adjusted
*/

var convertBandsls89 = function(lsImage) {
  var qa = lsImage.select('QA_PIXEL');
  var bands = lsImage.select('SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7')
                  .multiply(scale).add(offset).toFloat();
  return bands.addBands(qa).copyProperties(lsImage, ['system:time_start']);
};


//--------------------------------------------- Format Landsat 4/5/7 -------------------------------------------

  // For easier translation from band description to band name
  var ls457Rename = function(lsImage) {
    var sub = lsImage.select( ['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7','QA_PIXEL'])
      .rename(['blue','green','red','nir','sswir','lswir', 'qa_pixel']);
  
    return sub.copyProperties(lsImage, ['system:time_start']);
  };


/*
  Description: Converts landsat band value to proper scale and offset as described by dataset
  Input: lsImage: landsat image
  Output: landsat image with its band values adjusted
*/
var convertBandsls457 = function(lsImage) {
  var qa = lsImage.select('QA_PIXEL');
  var bands = lsImage.select('SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7')
                  .multiply(scale).add(offset).toFloat();
  return bands.addBands(qa).copyProperties(lsImage, ['system:time_start']);
};


// --------------------------------- Masking functions for Landsat Collections ------------------------------


/*
  Description: Masks landsat image pixels that are low quality (New Landsat collections)
  Input: lsImg: landsat image
  Output: landsat image with masked pixels based on the landsat pixel_qa band
*/
  var lsMaskNew = function(lsImg){
    var quality = lsImg.select(['qa_pixel']);
    var dilatedCloud = (1 << 1);
    var cloud = (1 << 3);
    var cloudShadow = (1 << 4);
    var water = (1 << 7);
    var snow = (1 << 5);
    // Cloud confidence is comprised of bits 8-9.
    // Add the two bits and interpolate them to a range from 0-3.
    // 0 = None, 1 = Low, 2 = Medium, 3 = High.
    var cloudConfidence = quality.bitwiseAnd(128)
        .add(quality.bitwiseAnd(256))
        .interpolate([0, 129, 257, 384], [0, 1, 2, 3], 'clamp').int();
    var cloudConfidenceMedHigh = cloudConfidence.gte(2); 
    
    var mask = quality.bitwiseAnd(cloud)
        .or(quality.bitwiseAnd(dilatedCloud))
        .or(quality.bitwiseAnd(cloudShadow))
        .or(quality.bitwiseAnd(water))
        .or(quality.bitwiseAnd(snow));
        //.or(cloudConfidenceMedHigh);
        
    var clear = mask.not();
    return lsImg.updateMask(clear).select(allVariables).copyProperties(lsImg, ['system:time_start']);
  };

  var SLC_lsMask = function(lsImg){
    var quality = lsImg.select(['qa_pixel']);
    var dilatedCloud = (1 << 1);
    var cloud = (1 << 3);
    var cloudShadow = (1 << 4);
    var water = (1 << 7);
    var snow = (1 << 5);
    // Cloud confidence is comprised of bits 8-9.
    // Add the two bits and interpolate them to a range from 0-3.
    // 0 = None, 1 = Low, 2 = Medium, 3 = High.
    var cloudConfidence = quality.bitwiseAnd(128)
        .add(quality.bitwiseAnd(256))
        .interpolate([0, 129, 257, 384], [0, 1, 2, 3], 'clamp').int();
    var cloudConfidenceMedHigh = cloudConfidence.gte(2); 
    
    var mask = quality.bitwiseAnd(cloud)
        .or(quality.bitwiseAnd(dilatedCloud))
        .or(quality.bitwiseAnd(cloudShadow))
        .or(quality.bitwiseAnd(water))
        .or(quality.bitwiseAnd(snow))
        .or(cloudConfidenceMedHigh);
        
    var clear = mask.not();
    // shaving some extra pixels off the clear image to remove sketchy data from bad L7 period
    //var clearBuff = clear.focal_min(300, "square", "meters", 1)
    
    return lsImg.updateMask(clear).select(allVariables)                                    
              .copyProperties(lsImg, ['system:time_start']);
    };
    
    
    
    
  var Indices = function(img) {
  
    var nbr  = img.normalizedDifference(['nir', 'lswir']).toFloat().rename('nbr');
    var nbr2 = img.normalizedDifference(['sswir', 'lswir']).toFloat().rename('nbr2');
    var ndvi = img.normalizedDifference(['nir','red']).toFloat().rename('ndvi');
    var ndmi = img.normalizedDifference(['nir', 'sswir']).toFloat().rename('ndmi');
    var ndwi = img.normalizedDifference(['green', 'nir']).toFloat().rename('ndwi');
    
    var evi  = getEVI(img);
    var mirbi = getMIRBI(img);
    var bai = getBAI(img);
    var baims = getBAIMs(img);
    var csi = getCSI(img);
    var bsi = getBSI(img);
    var msavi = getMSAVI(img);
    var tcb = getTCB(img);
    var tcg = getTCG(img);
    var tcw = getTCW(img);
    
    var qa = img.select('qa_pixel');
  
    return nbr.addBands([nbr2,ndvi,ndmi,ndwi,evi,mirbi,bai,baims,csi,bsi,msavi,tcb,tcg,tcw,qa])
            .copyProperties(img, ['system:time_start']);
  };


  // -------------- Map through all formatting functions and produce final combined Landsat collection ---------------

  var ls9 = ls9SR.map(convertBandsls89).map(ls89Rename).map(Indices)
                .map(lsMaskNew);
  var ls8 = ls8SR.map(convertBandsls89).map(ls89Rename).map(Indices)
                .map(lsMaskNew);
  var ls7_OK = ls7SR_OK.map(convertBandsls457).map(ls457Rename).map(Indices)
                .map(lsMaskNew);
  var ls7_BAD = ls7SR_BAD.map(convertBandsls457).map(ls457Rename).map(Indices)
                .map(SLC_lsMask);
  var ls5 = ls5SR.map(convertBandsls457).map(ls457Rename).map(Indices)
                .map(lsMaskNew);
  var ls4 = ls4SR.map(convertBandsls457).map(ls457Rename).map(Indices)
                .map(lsMaskNew);
                
  // Merge Landsat Collections
  var lsCol = ee.ImageCollection(ls9.merge(ls8.merge(ls7_BAD.merge(ls7_OK.merge(ls5.merge(ls4))))));



// // -------------------------------------------- Format Sentinel-2 --------------------------------------------
// S2 has been removed for now b/c the model predictions are not consistent and I need to
// explore better coefficients our using the Landsat-S2 hamonized dataset instead


//   // Sentinel-2 MSI: MultiSpectral Instrument, Level-2A
//   var sen2SR = ee.ImageCollection("COPERNICUS/S2_SR"); // 2017-03-28T00:00:00Z -


//   // For easier translation from band description to band name
//   var sent2Rename = function(lsImage) {
//     var sub = lsImage.select(['B2','B3','B4','B8','B11','B12','QA60'])
//           .rename(['blue','green','red','nir','sswir','lswir', 'qa_pixel']);
  
//     return sub.copyProperties(lsImage, ['system:time_start']);
//   };

//   /*
//     -links to different papers sentinel2 to landsat conversion equations:
  
//     1. https://www.mdpi.com/2072-4292/12/2/281
//     2. https://ieeexplore.ieee.org/document/9762921
//     3. https://hls.gsfc.nasa.gov/wp-content/uploads/2017/03/HLS.v1.2.UserGuide.pdf
  
//     currently using paper 3's conversion
//   */
//   var slope = ee.Image([1.020, 0.994, 1.017, 0.999, 0.999, 1.003]);
//   // scaled from original paper to match sentinel2 collection scaling (0.0001)
//   var intercepts = ee.Image([44.7, 10.9, -10.4, 2.5, 1.24, 11.9]); 

//   // Conversion constants as specified by the dataset
//   var scale_sen = 0.0001;

//   /*
//     Description: Converts sentinel2 imagery to be more similar to Landsat imagery through band adjustments
//     Input: senImage: sentinel2 image
//     Output: sentinel image with band adjustments as specified by the above papers
//   */

//   var convertToLandsat = function(senImage) {
//     var qa = senImage.select('QA60');
//     var bands = senImage.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12'])
//                       .multiply(slope).add(intercepts).multiply(scale_sen).toFloat();
//     return bands.addBands(qa).copyProperties(senImage, ['system:time_start']);
//   }




//   /*
//     Description: Masks sentinel2 image pixels that are low quality
//     Input: senImage: sentinel2 image
//     Output: sentinel2 image with masked pixels based on the sentinel2 QA60 cloud band
//   */

//   var senMask = function(senImage) {
//     var quality = senImage.select('qa_pixel');

//     // Bits 10 and 11 are clouds and cirrus, respectively.
//     var cloudBitMask = 1 << 10;
//     var cirrusBitMask = 1 << 11;

//     // Both flags should be set to zero, indicating clear conditions.
//     var clear = quality.bitwiseAnd(cloudBitMask).eq(0)
//         .and(quality.bitwiseAnd(cirrusBitMask).eq(0));

//     return senImage.updateMask(clear).select([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14])                                    
//               .copyProperties(senImage, ['system:time_start']);
//   };


//   // Create spectral indices and mask low quality pixels
//   var sen2 = sen2SR.map(convertToLandsat).map(sent2Rename).map(Indices)
//                     .map(senMask);
                  
//   var landsatSentinelCol = ee.ImageCollection(lsCol.merge(sen2));



  var imgCol = lsCol;


  // create water mask
  var dryLand = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select(['max_extent']).eq(0).selfMask().clip(ROI);
  
  // create land mask
  var mainlands = ee.FeatureCollection('projects/sat-io/open-datasets/shoreline/mainlands');
  var big_islands = ee.FeatureCollection('projects/sat-io/open-datasets/shoreline/big_islands');
  var merged = mainlands.merge(big_islands);
  
  // Rasterize polys and clip to ROI
  var land = merged.reduceToImage({
    properties: ['OBJECTID'],
    reducer: ee.Reducer.count()
  }).clip(ROI);

  
  // pre-fire variable names
  var preVariables = allVariables.map(function(word) {
    return ee.String('pre_').cat(word);
  });


  // post-fire variable names
  var postVariables = allVariables.map(function(word) {
    return ee.String('post_').cat(word);
  });

  // transparent image used to backfill empty pixel values in case there is no data
  var transparentImage = allVariables.map(function(count) {
    return ee.Image().toFloat();
  });

  transparentImage = ee.Image.cat(transparentImage).rename(allVariables);




  var startDate = ee.Date(year_select + '-06-15');
  var endDate = ee.Date(year_select + '-09-01');
  var THEclassifier = classifier;
  
  // Pre-Imagery
  var preFireYearStart = ee.Date(startDate).advance(-1, 'year');
  var preFireYearEnd = ee.Date(endDate).advance(-1, 'year');
  
  var preFilteredCol = imgCol.filterBounds(ROI)
                             .filterDate(preFireYearStart, preFireYearEnd)
                             .merge(ee.ImageCollection(transparentImage));
                             
  var pre_filled = ee.Image(preFilteredCol.median())
                             .select(allVariables, preVariables);
 
  // Post-Imagery
  var postFireYearStart = ee.Date(startDate).advance(1, 'year');
  var postFireYearEnd = ee.Date(endDate).advance(1, 'year');
  
  var postFilteredCol = imgCol.filterBounds(ROI)
                             .filterDate(postFireYearStart, postFireYearEnd)
                             .merge(ee.ImageCollection(transparentImage));
  
  var post_filled = ee.Image(postFilteredCol.median())
                             .select(allVariables, postVariables);

  var fireIndices = pre_filled.addBands(post_filled);
  
  // calculate dNBR  
  var burnIndices = fireIndices.expression(
              "(b('pre_nbr') - b('post_nbr')) * 1000")
              .rename('dnbr').toInt().addBands(fireIndices);

  // calculate RBR 
  var burnIndices2 = burnIndices.expression(
            "b('dnbr') / (b('pre_nbr') + 1.001)")
            .rename('rbr').toInt().addBands(burnIndices);
            
  // calculate RdNBR
   var burnIndices3 = burnIndices2.expression(
            "abs(b('pre_nbr')) < 0.001 ? 0.001" + 
            ": b('pre_nbr')")
            .abs().sqrt().rename('pre_nbr3').toFloat().addBands(burnIndices2);
  
  var burnIndices4 = burnIndices3.expression(
            "b('dnbr') / b('pre_nbr3')")
            .rename('rdnbr').toInt().addBands(burnIndices3);
            
  // calculate dNDVI
  var burnIndices5 = burnIndices4.expression(
              "(b('pre_ndvi') - b('post_ndvi')) * 1000")
              .rename('dndvi').toInt().addBands(burnIndices4);
              
  // calculate dEVI
  var burnIndices6 = burnIndices5.expression(
              "(b('pre_evi') - b('post_evi')) * 1000")       
              .rename('devi').toInt().addBands(burnIndices5);

   // calculate dNDMI  
  var burnIndices7 = burnIndices6.expression(
              "(b('pre_ndmi') - b('post_ndmi')) * 1000")                  
              .rename('dndmi').toInt().addBands(burnIndices6);
              
   // calculate dMIRBI   
  var burnIndices8 = burnIndices7.expression(
              "(b('pre_mirbi') - b('post_mirbi')) * 1000")             
              .rename('dmirbi').toInt().addBands(burnIndices7);
              
   // calculate dNBR2   
  var burnIndices9 = burnIndices8.expression(
              "(b('pre_nbr2') - b('post_nbr2')) * 1000")             
              .rename('dnbr2').toInt().addBands(burnIndices8);
  
  // calculate dNDWI            
  var burnIndices10 = burnIndices9.expression(
            "(b('pre_ndwi') - b('post_ndwi')) * 1000")             
            .rename('dndwi').toInt().addBands(burnIndices9);
            
  // calculate dBAI           
  var burnIndices11 = burnIndices10.expression(
            "(b('pre_bai') - b('post_bai'))")             
            .rename('dbai').toInt().addBands(burnIndices10);

  // calculate dBAIMs            
  var burnIndices12 = burnIndices11.expression(
            "(b('pre_baims') - b('post_baims')) * 10")             
            .rename('dbaims').toInt().addBands(burnIndices11);
            
  // calculate dCSI            
  var burnIndices13 = burnIndices12.expression(
            "(b('pre_csi') - b('post_csi')) * 1000")             
            .rename('dcsi').toInt().addBands(burnIndices12);
            
  // calculate dBSI            
  var burnIndices14 = burnIndices13.expression(
            "(b('pre_bsi') - b('post_bsi')) * 1000")             
            .rename('dbsi').toInt().addBands(burnIndices13);
  
  // calculate dTCB            
  var burnIndices15 = burnIndices14.expression(
            "(b('pre_tcb') - b('post_tcb')) * 100")             
            .rename('dtcb').toInt().addBands(burnIndices14);
            
  // calculate dTCG            
  var burnIndices16 = burnIndices15.expression(
            "(b('pre_tcg') - b('post_tcg')) * 100")             
            .rename('dtcg').toInt().addBands(burnIndices15);
            
  // calculate dTCW            
  var burnIndices17 = burnIndices16.expression(
            "(b('pre_tcw') - b('post_tcw')) * 100")             
            .rename('dtcw').toInt().addBands(burnIndices16);

  // calculate dMSAVI            
  var burnIndices18 = burnIndices17.expression(
            "(b('pre_msavi') - b('post_msavi')) * 1000")             
            .rename('dmsavi').toInt().addBands(burnIndices17);
  
  // mask water points
  var burnIndices19 = burnIndices18.updateMask(dryLand);  
  
  // reformat the predictorVariable list for easier selecting/subsetting of indices
  var lowerCaseVariables = predictorVariables.map(function(str) {
    return ee.String(str).toLowerCase();
  });
  
  // rename and select bands
  burnIndices19 = burnIndices19.select(lowerCaseVariables, predictorVariables); 




  var predictedImage = burnIndices19.classify(THEclassifier).updateMask(dryLand).updateMask(land);


  ////////////////////////////////////////////////////////////////////////////////////////
  //// time series deviations 

  // get median of TimeSeries over ROI (1-3 years prior)  
  var Tm1 = imgCol.filterDate(startDate.advance(-1,'years'),endDate.advance(-1,'years'));
  var Tm2 = imgCol.filterDate(startDate.advance(-2,'years'),endDate.advance(-2,'years'));
  var Tm3 = imgCol.filterDate(startDate.advance(-3,'years'),endDate.advance(-3,'years'));
  var PREmedian = ee.Image((Tm1.merge(Tm2.merge(Tm3))).median());


  // calculate deviation from median - RATIO across each image in the TS
  // compressing each TS down to median (tested mean and some others but median better)
  var TSdevDiv = imgCol.map(function (IMG){return ee.Image(IMG.divide(PREmedian)).copyProperties(IMG,['system:time_start'])});
  var divColA = TSdevDiv.filterDate(startDate.advance(1,'years'),endDate.advance(1,'years')).median().clip(ROI);
  var divColB = TSdevDiv.filterDate(startDate.advance(0,'years'),endDate.advance(0,'years')).median().clip(ROI);
  // return lowest value across the 2 ImgCols - either [year of fire vs PREfire] OR [postFire vs PREfire]
  var divCol = ee.Image(ee.ImageCollection([divColA,divColB]).min());


  // calculate deviation from median - SUBTRACT across each image in the TS
  // compressing each TS down to mean (tested median and some others but mean better)
  var TSdevSub = imgCol.map(function (IMG){return ee.Image(IMG.subtract(PREmedian)).copyProperties(IMG,['system:time_start'])});
  var subColA = TSdevSub.filterDate(startDate.advance(1,'years'),endDate.advance(1,'years')).mean().clip(ROI);
  var subColB = TSdevSub.filterDate(startDate.advance(0,'years'),endDate.advance(0,'years')).mean().clip(ROI);
  // return lowest value across the 2 ImgCols - either [year of fire vs PREfire] OR [postFire vs PREfire]
  var subCol = ee.Image(ee.ImageCollection([subColA,subColB]).min());

  // this is how I will grab the lowest NBR value across the 2 timeseries
  // originaly tried mean value but settled on post-fire NBR needed to be <0 (using min here)
  var meanColA = imgCol.filterDate(startDate.advance(1,'years'),endDate.advance(1,'years')).min().clip(ROI);
  var meanColB = imgCol.filterDate(startDate.advance(0,'years'),endDate.advance(0,'years')).min().clip(ROI);
  // return lowest value across the 2 ImgCols - either [year of fire vs PREfire] OR [postFire vs PREfire]
  var meanCol = ee.Image(ee.ImageCollection([meanColA,meanColB]).min());

  // mask lakes then ocean
  var meanIMG = meanCol.updateMask(dryLand).updateMask(land);
  var divIMG = divCol.updateMask(dryLand).updateMask(land);
  var subIMG = subCol.updateMask(dryLand).updateMask(land);


  /////////////////////////////////////////////////////////////// 

  // now threshold using our 4-rules
  var hiRFthresh = predictedImage.gt(0.9);            // high RF pred
  var hiDEVthresh = divIMG.select(['nbr2']).lt(0.5);  // >50% drop compared to the historical avg
  var hiSUBthresh = subIMG.select(['nbr2']).lt(-0.1); // <0.1 difference from historical avg
  var hiMNthresh = meanIMG.select(['nbr']).lt(0);     // post-fire NBR below 0 


  
  //using a grid to breakup the exports
  var grid = ROI.geometry().coveringGrid('EPSG:4326', 1000000);

  if(Export_select === true && ROI_select === false) {
      
      Map.addLayer(predictedImage, {
        min: 0,
        max: 1,
        palette: ['#fee8c8', '#fce1bd', '#fadab2', '#f8d3a8', 
              '#f7cc9e', '#f5c594', '#f4bd8a', '#f3b681',
              '#f2ae78', '#f0a66f', '#e55637', '#e34a33']},
        'RFprediction', false);  
    
    for( var i = 1; i < 24; i++) {   
      //there are 24 subGrid polys
      // loop through each polyGrid
      var subROI = ee.Feature(grid.toList(24).get(i)).geometry();
      var one = hiRFthresh.clip(subROI);
      var two = hiDEVthresh.clip(subROI);
      var three = hiSUBthresh.clip(subROI);
      var four = hiMNthresh.clip(subROI);
      var subIMG = one.add(two).add(three).add(four).eq(4).selfMask();
    
      var Res = 60;      // pixel size (meters) of output
      var pxFilter = 0;  // if you want to limit connected pixel count
      
      var vectors = subIMG.reduceToVectors({
        reducer: ee.Reducer.countEvery(), 
        geometry: subROI,
        scale: Res,
        maxPixels: 1e13,
        tileScale: 4
      });//.filter(ee.Filter.gt('count', pxFilter))


  
    var iVar = ee.Number(i).format('%02d').getInfo();
    Export.table.toDrive({
      collection: vectors,
      description: "candidateFires__"+year_select+'__ROIsub_'+iVar+"_"+pxFilter+'px'+Res+'m', //filename defaults to description
      folder: "tundraFire_exports",
      fileFormat: 'GeoJSON'
    });
  }

  }
  else if(Export_select === true && ROI_select === true) {
    
    Map.addLayer(predictedImage, {
      min: 0,
      max: 1,
      palette: ['#fee8c8', '#fce1bd', '#fadab2', '#f8d3a8', 
              '#f7cc9e', '#f5c594', '#f4bd8a', '#f3b681',
              '#f2ae78', '#f0a66f', '#e55637', '#e34a33']},
      'RFprediction', true);
    
    var one = hiRFthresh.clip(ROI);
    var two = hiDEVthresh.clip(ROI);
    var three = hiSUBthresh.clip(ROI);
    var four = hiMNthresh.clip(ROI);
    var subIMG = one.add(two).add(three).add(four).eq(4).selfMask();


    var Res = 60;
    var pxFilter = 0;
    var iVar = ee.String('drawROI').getInfo()
    var vectors = subIMG.reduceToVectors({
        reducer: ee.Reducer.countEvery(), 
        geometry: ROI,
        scale: Res,
        maxPixels: 1e13,
        tileScale: 4
      });//.filter(ee.Filter.gt('count', pxFilter))
    
     Export.table.toDrive({
      collection: vectors,
      description: "candidateFires__"+year_select+'__'+iVar+"_"+pxFilter+'px'+Res+'m', //filename defaults to description
      folder: "tundraFire_exports",
      fileFormat: 'GeoJSON'
    });
    
  }
  else if(Export_select === false) {
    Map.addLayer(predictedImage, {
      min: 0,
      max: 1,
      palette: ['#fee8c8', '#fce1bd', '#fadab2', '#f8d3a8', 
              '#f7cc9e', '#f5c594', '#f4bd8a', '#f3b681',
              '#f2ae78', '#f0a66f', '#e55637', '#e34a33']},
      'RFprediction', true);
  }




  
});


