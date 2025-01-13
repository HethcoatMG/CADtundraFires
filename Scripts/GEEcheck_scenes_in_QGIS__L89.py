# in addition to the script here to viz individual scenes
# we also used the amazing Landsat Time Series Explorer
# by Justin Braaten : https://github.com/jdbcode/ee-rgb-timeseries

import ee
from ee_plugin import Map

# continuous lon/lat display - even when projected:
# https://gis.stackexchange.com/questions/448448/show-running-lat-long-coordinates-in-status-bar-on-bottom

#[% round(x(transform(@canvas_cursor_point, 'ESRI:102113', 'EPSG:4326' )),2)%],  [% round(y(transform(@canvas_cursor_point, 'ESRI:102113', 'EPSG:4326' )),2)%]
    
    
    
ROI = ee.Geometry.Point([-110.3, 67.5])
timeStart = ee.Date('2015-06-15')
timeStop = ee.Date('2015-09-15')

L4 = ee.ImageCollection("LANDSAT/LM04/C02/T1_L2") # 1982-1993
L5 = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2") # 1984-2012
L7 = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2") # 1999-pres
L8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2") # 2013-pres
L9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2") # 2021-pres
L457 = ee.ImageCollection(L4.merge(L5).merge(L7))
L89 = ee.ImageCollection(L8.merge(L9))

scale = 0.0000275
offset = -0.2

def scaleL457(IMG):
  bands = IMG.select('SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7').multiply(scale).add(offset).addBands(ee.Image.constant(0)).rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'S2'])
  return bands.copyProperties(IMG, ['system:time_start'])

def scaleL89(IMG):
  bands = IMG.select('SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7').multiply(scale).add(offset).addBands(ee.Image.constant(0)).rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'S2'])
  return bands.copyProperties(IMG, ['system:time_start'])

# Function to scale Sentinel-2 images
def scaleS2(IMG):
  bands = IMG.select(['B2', 'B3', 'B4', 'B8', 'B11', 'B12']).divide(10000).addBands(ee.Image.constant(1)).rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'S2'])
  return bands.copyProperties(IMG, ['system:time_start'])

Viz = {'bands': ['swir1', 'nir', 'red'] }

# T-1
subCol1 = L89.filterBounds(ROI).filterDate(timeStart.advance(-1,'years'), timeStop.advance(-1,'years')).sort('system:time_start', False)
print('T-1: ',subCol1.size().subtract(1).getInfo())
IMG1 = ee.Image(subCol1.map(scaleL89).toList(100).get(0))
Map.addLayer(IMG1, Viz, "T-1", False)

# T0
subCol2 = L89.filterBounds(ROI).filterDate(timeStart, timeStop).sort('system:time_start', False)
print('T0: ',subCol2.size().subtract(1).getInfo())
IMG2 = ee.Image(subCol2.map(scaleL89).toList(100).get(0))
Map.addLayer(IMG2, Viz, "T0")

# T+1
subCol3 = L89.filterBounds(ROI).filterDate(timeStart.advance(1,'years'), timeStop.advance(1,'years')).sort('system:time_start', False)
print('T+1: ',subCol3.size().subtract(1).getInfo())
IMG3 = ee.Image(subCol3.map(scaleL89).toList(100).get(0))
Map.addLayer(IMG3, Viz, "T+1", False)
