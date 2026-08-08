import React from 'react';

// Botón de lupa + lightbox compartidos entre ExamRunner (chrome francés,
// timed) y ExamReview (chrome español, untimed) -- ver CLAUDE.md, "Frontend
// architecture" sobre el split de idioma. Los textos accesibles (label del
// botón, label de cerrar) los decide cada llamador para mantener ese split.
// El botón es HERMANO del <label>/radio que envuelve la miniatura, nunca su
// descendiente -- un <button> anidado dentro de un <label> dispara el click
// forward nativo hacia el <input> asociado incluso con stopPropagation, así
// que la única forma robusta de evitarlo es no anidarlo.
export const ZoomButton = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="absolute top-2 right-2 bg-gray-800/60 hover:bg-gray-800/80 text-white rounded-full w-8 h-8 flex items-center justify-center"
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
      <path d="M9 6.25a.75.75 0 01.75.75v1.25H11a.75.75 0 010 1.5H9.75V11a.75.75 0 01-1.5 0V9.75H7a.75.75 0 010-1.5h1.25V7A.75.75 0 019 6.25z" />
    </svg>
  </button>
);

export const ImageZoomModal = ({ src, alt, onClose, closeLabel }) => {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain bg-white rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute top-6 right-6 bg-gray-800/70 hover:bg-gray-800/90 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl leading-none"
      >
        ×
      </button>
    </div>
  );
};
