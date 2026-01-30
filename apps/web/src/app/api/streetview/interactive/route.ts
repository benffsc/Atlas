import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

/**
 * GET /api/streetview/interactive?lat=38.5&lng=-122.8
 *
 * Returns an HTML page with an interactive Google Street View panorama
 * using the JavaScript API. The panorama communicates heading/pitch/position
 * changes back to the parent window via postMessage, and accepts
 * `set-pov` messages to update the view programmatically.
 *
 * Keeps the API key server-side in the rendered HTML.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 }
    );
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key not configured" },
      { status: 500 }
    );
  }

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body,#pano{width:100%;height:100%;overflow:hidden}
  #no-sv{display:none;width:100%;height:100%;background:#1a1a1a;color:#9ca3af;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    align-items:center;justify-content:center;flex-direction:column;gap:12px;font-size:14px}
  #no-sv .icon{font-size:48px;opacity:0.5}
</style>
</head><body>
<div id="pano"></div>
<div id="no-sv">
  <div class="icon">🚫</div>
  <div>Street View not available at this location</div>
</div>
<script>
var panorama;
function initPano(){
  var sv=new google.maps.StreetViewService();
  var loc={lat:${lat},lng:${lng}};

  sv.getPanorama({location:loc,radius:50},function(data,status){
    if(status!==google.maps.StreetViewStatus.OK){
      document.getElementById('pano').style.display='none';
      document.getElementById('no-sv').style.display='flex';
      window.parent.postMessage({type:'streetview-error',message:'No coverage'},'*');
      return;
    }

    panorama=new google.maps.StreetViewPanorama(
      document.getElementById('pano'),{
        position:loc,
        pov:{heading:0,pitch:0},
        zoom:1,
        addressControl:false,
        showRoadLabels:false,
        motionTracking:false,
        motionTrackingControl:false,
        linksControl:true,
        fullscreenControl:false
      }
    );

    panorama.addListener('pov_changed',function(){
      var pov=panorama.getPov();
      window.parent.postMessage({
        type:'streetview-pov',
        heading:Math.round((pov.heading%360+360)%360),
        pitch:Math.round(pov.pitch)
      },'*');
    });

    panorama.addListener('position_changed',function(){
      var pos=panorama.getPosition();
      if(pos){
        window.parent.postMessage({
          type:'streetview-position',
          lat:pos.lat(),
          lng:pos.lng()
        },'*');
      }
    });

    window.parent.postMessage({type:'streetview-ready'},'*');
  });

  window.addEventListener('message',function(e){
    if(!panorama)return;
    if(e.data&&e.data.type==='set-pov'){
      panorama.setPov({
        heading:e.data.heading||0,
        pitch:e.data.pitch||0
      });
    }
  });
}
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&callback=initPano" async defer></script>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
