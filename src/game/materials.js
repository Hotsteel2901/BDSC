import * as THREE from 'three';
import {
  makeFacadeVariants, makeRoofTexture, makeStreetTexture, makeSidewalkTexture,
  makeMetalTexture, makeCrateTexture, makeInteriorWallTexture, makeInteriorFloorTexture,
  makeHazardTexture,
} from './textures.js';

/**
 * Builds and owns the shared material set for the whole city.
 * Materials are deliberately high-contrast and fairly matte: the ASCII shader
 * converts luminance to glyph density, so mid-tones flatten into mush.
 */
export function createMaterials() {
  const facades = makeFacadeVariants(6).map(({ albedo, emissive }) =>
    new THREE.MeshStandardMaterial({
      map: albedo,
      emissiveMap: emissive,
      emissive: new THREE.Color(0xffd9a0),
      emissiveIntensity: 1.15,
      roughness: 0.82,
      metalness: 0.05,
      vertexColors: true,
    })
  );

  const roof = new THREE.MeshStandardMaterial({
    map: makeRoofTexture(),
    roughness: 0.95, metalness: 0.02, vertexColors: true,
  });

  const street = new THREE.MeshStandardMaterial({ map: makeStreetTexture(), roughness: 0.98, metalness: 0.0 });
  street.map.repeat.set(1, 1);

  const sidewalk = new THREE.MeshStandardMaterial({ map: makeSidewalkTexture(), roughness: 0.95, metalness: 0.0 });

  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.9, vertexColors: true });
  const metal = new THREE.MeshStandardMaterial({ map: makeMetalTexture(), roughness: 0.5, metalness: 0.7, vertexColors: true });
  const crate = new THREE.MeshStandardMaterial({ map: makeCrateTexture(), roughness: 0.85, metalness: 0.05 });
  const hazard = new THREE.MeshStandardMaterial({ map: makeHazardTexture(), roughness: 0.8, metalness: 0.2 });

  const glassEmissive = new THREE.MeshStandardMaterial({
    color: 0x0a1a24, emissive: 0x66ccff, emissiveIntensity: 0.6,
    roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.45,
  });

  const lampEmissive = new THREE.MeshStandardMaterial({ color: 0x221a08, emissive: 0xffcc66, emissiveIntensity: 2.2, roughness: 0.4 });
  const neonGreen = new THREE.MeshBasicMaterial({ color: 0x37ff8b });
  const neonPink = new THREE.MeshBasicMaterial({ color: 0xff4d9e });
  const neonCyan = new THREE.MeshBasicMaterial({ color: 0x4de0ff });
  const neonAmber = new THREE.MeshBasicMaterial({ color: 0xffb000 });

  const interiorWall = new THREE.MeshStandardMaterial({ map: makeInteriorWallTexture(), roughness: 0.9, vertexColors: true });
  const interiorFloor = new THREE.MeshStandardMaterial({ map: makeInteriorFloorTexture(), roughness: 0.9 });

  const windowPane = new THREE.MeshStandardMaterial({
    color: 0x14202c, emissive: 0x88bbff, emissiveIntensity: 0.35,
    roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.5,
  });

  const enemySkin = new THREE.MeshStandardMaterial({ color: 0x9aa4ac, emissive: 0x220000, emissiveIntensity: 0.0, roughness: 0.7, metalness: 0.3 });
  const enemyCore = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2222, emissiveIntensity: 2.0, roughness: 0.4 });
  const enemyAlly = new THREE.MeshStandardMaterial({ color: 0x223322, emissive: 0x22ff66, emissiveIntensity: 1.4, roughness: 0.5 });

  return {
    facades, roof, street, sidewalk, concrete, metal, crate, hazard,
    glassEmissive, lampEmissive, neonGreen, neonPink, neonCyan, neonAmber,
    interiorWall, interiorFloor, windowPane,
    enemySkin, enemyCore, enemyAlly,
  };
}
