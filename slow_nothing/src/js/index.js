const regl = require('regl')({
  extensions: ['webgl_draw_buffers', 'oes_texture_float']
});
const glslify = require('glslify');
import Pointer from './Pointer';
import AnimeLoop from './AnimeLoop';
import {onceLoaded, clamp} from './util';
import ImageLoader from './ImageLoader';
import UI from './UI';

const DEV = true;
const seed = DEV ? 13875.579831 : new Date().getTime() % 100000 + 0.5831;

const pointer = new Pointer(regl._gl.canvas);
let morphAmount = 0;
pointer.addPressingListener(e => {
  morphAmount += pointer.pressCheckInterval / 1000 * pointer.pressure * 0.1;
});

// TODO: user defined fragment shader
// TODO: masking transition on switching shaders
const globalScope = regl({
  vert: glslify('../glsl/vert.glsl'),

  attributes: {
    position: regl.buffer([
      [-1,-1],[1,-1],[-1,1],  // no need to flatten nested arrays, regl automatically
      [-1,1],[1,1],[1,-1]     // unrolls them into a typedarray (default Float32)
    ])
  },

  uniforms: {
    uResolution: ({viewportWidth, viewportHeight}) => [
      viewportWidth, viewportHeight
    ],
    uTime: ({tick}) => 0.01 * tick,
    uMouse: () => [pointer.position.x, pointer.position.y],
    uMorph: () => morphAmount,
    uGrid: ({viewportWidth, viewportHeight}) => {
      const ratio = 0.32;
      return viewportHeight >= viewportWidth ? [1, viewportHeight / viewportWidth * ratio]
        : [viewportWidth / viewportHeight * ratio, 1]
    }
  },

  count: 6,
  depth: {
    enable: false,
    mask: false,
  }
});


const fbo = regl.framebuffer({
  color: [
    regl.texture({ type: 'float' }),
    regl.texture({ type: 'float' })
  ],
  colorCount: 2,
  depth: false
});

const modes = ['modeOrigin', 'modeSlow2', 'modeWater', 'modeSlow1'];
const currentMode = [modes[0], modes[1]];
// TODO: if click on another mode through UI, push mode to `drawModes`
let draw2FragData = regl({
  frag: () => `precision mediump float;
#extension GL_EXT_draw_buffers : require
#define SEED ${seed}
#define MODE0 ${currentMode[0]}
#define MODE1 ${currentMode[1]}
` + glslify.file('../glsl/fragData.glsl'),
  framebuffer: fbo
});

Promise.all([
  ImageLoader.load('./mix.jpg'),
  onceLoaded()
]).then(data => {
  const mixImage = data[0];
  UI.onSwitch('switch', () => {
    currentMode[0] = currentMode[1];
    currentMode[1] = currentMode[0];

    // does not work
    draw2FragData = regl({
      frag: () => `precision mediump float;
#extension GL_EXT_draw_buffers : require
#define SEED ${seed}
#define MODE0 ${currentMode[0]}
#define MODE1 ${currentMode[1]}
` + glslify.file('../glsl/fragData.glsl'),
      framebuffer: fbo
    });
  });

  const draw2Screen = regl({
    uniforms: {
      mode0Tex: fbo.color[0],
      mode1Tex: fbo.color[1],
      mixTex: regl.texture(mixImage),
      transitionRatio: regl.prop('transitionRatio')
    },
    frag: `precision mediump float;
      uniform vec2 uResolution;
      uniform sampler2D mode0Tex;
      uniform sampler2D mode1Tex;
      uniform sampler2D mixTex;
      uniform float transitionRatio;

      const float threshold = 0.36;
      void main() {
        vec2 uv = gl_FragCoord.xy / uResolution;
        vec4 tex0 = texture2D(mode0Tex, uv);
        vec4 tex1 = texture2D(mode1Tex, uv);

        // from https://github.com/fernandojsg/three.js-demos/blob/master/crossfade/js/transition.js
        vec4 mixMap = texture2D( mixTex, uv );
				float r = transitionRatio * (1.0 + threshold * 2.0) - threshold;
				float mixf = clamp((mixMap.r - r) * (1.0/threshold), 0.0, 1.0);

				gl_FragColor = mix( tex1, tex0, mixf );
      }
    `
  });

  let anime = new AnimeLoop(() => {
    regl.poll();
    regl.clear({
      depth: 1,
      color: [0, 0, 0, 0]
    });

    globalScope(({ viewportWidth, viewportHeight }) => {
      fbo.resize(viewportWidth, viewportHeight);
      // TODO: after transition done, remove all modes except the last one
      draw2FragData();
      // for(let draw of drawModes) {
      //   draw();
      // }

      draw2Screen({
        transitionRatio: clamp(anime.runTime / 5000, 0, 1)
      });
    });
  });

}).catch(e => {
  document.querySelector('#message').innerHTML = 'Something went wrong.<br>' + e.message;
  console.log(e);
});