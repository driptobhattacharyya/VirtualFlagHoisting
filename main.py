import cv2
import mediapipe as mp
import pygame
import numpy as np
import math
import time
import random
import os
from urllib.request import urlretrieve

# Initialize components
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(max_num_hands=1, min_detection_confidence=0.7)
cap = cv2.VideoCapture(0)

# Pygame setup
pygame.init()
# Set fullscreen mode
screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
screen_width, screen_height = screen.get_size()
pygame.display.set_caption("Independence Day Flag Hoisting")

# Load fonts
pygame.font.init()
font_large = pygame.font.SysFont('Arial', 36)
font_small = pygame.font.SysFont('Arial', 24)

# Colors (Indian flag colors)
SAFFRON = (255, 153, 51)  # Deep saffron (kesari)
WHITE = (255, 255, 255)   # White
GREEN = (18, 136, 7)      # India green
NAVY_BLUE = (0, 0, 128)   # Navy blue for Ashoka Chakra
SKY_BLUE = (135, 206, 235) # Sky blue background
BROWN = (139, 69, 19)     # Brown for flag pole

# Flag parameters
flag_height = 0
max_height = screen_height * 0.7  # Match the pole height to 70% of screen height
pole_x, pole_y = screen_width // 2, screen_height * 0.1  # Center horizontally, 10% from top

# Flag dimensions (3:2 ratio as per standards)
flag_width = int(screen_width * 0.15)  # 15% of screen width
flag_height_full = int(flag_width * 2/3)  # Maintain 3:2 ratio
stripe_height = flag_height_full // 3

# Ashoka Chakra
chakra_radius = stripe_height // 2

# Assets directory
assets_dir = "assets"
os.makedirs(assets_dir, exist_ok=True)

# Download required images if they don't exist
def download_image(url, filename):
    file_path = os.path.join(assets_dir, filename)
    if not os.path.exists(file_path):
        try:
            urlretrieve(url, file_path)
            print(f"Downloaded {filename} to {file_path}")
            return True
        except Exception as e:
            print(f"Failed to download {filename}: {e}")
            return False
    return True

# Download Ashoka Chakra image
chakra_image_path = os.path.join(assets_dir, "ashoka_chakra.png")
chakra_downloaded = download_image("https://upload.wikimedia.org/wikipedia/commons/1/17/Ashoka_Chakra.svg", "ashoka_chakra.png")

# Create a simple gradient background instead of downloading an image
background_image_path = os.path.join(assets_dir, "gptfort_day.png")
# Using a more reliable image or creating a gradient background
if not os.path.exists(background_image_path):
    # Create a gradient background
    background_surface = pygame.Surface((800, 600))
    for y in range(600):
        # Gradient from darker blue at top to lighter blue at bottom
        color = (100 - y//20, 180 - y//30, 255 - y//10)
        pygame.draw.line(background_surface, color, (0, y), (800, y))
    # Save the gradient as an image
    pygame.image.save(background_surface, background_image_path)
    print(f"Created gradient background at {background_image_path}")

# Download decorative elements
decor_image_path = os.path.join(assets_dir, "india_decor.png")
decor_downloaded = download_image("https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Emblem_of_India.svg/800px-Emblem_of_India.svg.png", "india_decor.png")

# Load images with fallbacks if needed
def load_image(image_path, size=None):
    try:
        image = pygame.image.load(image_path)
        if size:
            image = pygame.transform.scale(image, size)
        return image
    except Exception as e:
        print(f"Failed to load image {image_path}: {e}")
        # Create a placeholder surface
        if size:
            placeholder = pygame.Surface(size, pygame.SRCALPHA)
            placeholder.fill((200, 200, 200, 128))  # Semi-transparent gray
            return placeholder
        return None

# Create the Ashoka Chakra image (always use the fallback to ensure it works)
# Create a simple blue circle with spokes as fallback
chakra_surface = pygame.Surface((chakra_radius*2, chakra_radius*2), pygame.SRCALPHA)
pygame.draw.circle(chakra_surface, NAVY_BLUE, (chakra_radius, chakra_radius), chakra_radius)
# Draw 24 spokes
for i in range(24):
    angle = i * (360 / 24)
    rad = math.radians(angle)
    x1 = chakra_radius + (chakra_radius - 2) * math.cos(rad)
    y1 = chakra_radius + (chakra_radius - 2) * math.sin(rad)
    x2 = chakra_radius + 5 * math.cos(rad)
    y2 = chakra_radius + 5 * math.sin(rad)
    pygame.draw.line(chakra_surface, WHITE, (x1, y1), (x2, y2), 2)
chakra_image = chakra_surface

# Load background image
background_image = load_image(background_image_path, (screen_width, screen_height))
if not background_image:
    # Create a gradient background as fallback
    background_image = pygame.Surface((screen_width, screen_height))
    for y in range(screen_height):
        # Gradient from darker blue at top to lighter blue at bottom
        color = (135 - int(y/(screen_height/60)), 206 - int(y/(screen_height/30)), 235)
        pygame.draw.line(background_image, color, (0, y), (screen_width, y))

# Load decorative emblem
decor_image = load_image(decor_image_path, (100, 100))

# Create a semi-transparent overlay for text backgrounds
text_overlay_width = int(screen_width * 0.5)  # 50% of screen width
text_overlay_height = int(screen_height * 0.13)  # 13% of screen height
text_overlay = pygame.Surface((text_overlay_width, text_overlay_height), pygame.SRCALPHA)
text_overlay.fill((255, 255, 255, 180))  # Semi-transparent white

# Fireworks parameters
fireworks = []
particles = []
fireworks_active = False

# Game state
state = "hoisting"  # "hoisting", "celebration", "end"

# Firework class for celebration animation
class Firework:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.color = (random.randint(50, 255), random.randint(50, 255), random.randint(50, 255))
        self.radius = 3
        self.velocity = random.randint(-15, -8)
        self.gravity = 0.2
        self.exploded = False
        self.particles_count = random.randint(30, 50)
    
    def update(self):
        self.y += self.velocity
        self.velocity += self.gravity
        
        # Check if firework should explode
        if self.velocity >= 0 and not self.exploded:
            self.explode()
            self.exploded = True
            return True
        return False
    
    def explode(self):
        global particles
        for _ in range(self.particles_count):
            particles.append(Particle(self.x, self.y, self.color))
    
    def draw(self, surface):
        pygame.draw.circle(surface, self.color, (int(self.x), int(self.y)), self.radius)

# Particle class for firework explosion
class Particle:
    def __init__(self, x, y, color):
        self.x = x
        self.y = y
        self.color = color
        self.radius = random.randint(1, 3)
        self.velocity_x = random.uniform(-3, 3)
        self.velocity_y = random.uniform(-3, 3)
        self.gravity = 0.1
        self.life = 100  # Particle lifetime
    
    def update(self):
        self.x += self.velocity_x
        self.y += self.velocity_y
        self.velocity_y += self.gravity
        self.life -= 1
        
        # Fade out effect
        if self.life < 50:
            self.radius = max(0, self.radius - 0.05)
        
        return self.life <= 0 or self.radius <= 0
    
    def draw(self, surface):
        alpha = min(255, self.life * 3)
        color_with_alpha = (*self.color, alpha)
        
        # Create a temporary surface with alpha channel
        temp_surface = pygame.Surface((self.radius*2, self.radius*2), pygame.SRCALPHA)
        pygame.draw.circle(temp_surface, color_with_alpha, (self.radius, self.radius), self.radius)
        surface.blit(temp_surface, (int(self.x - self.radius), int(self.y - self.radius)))

# Draw the Indian flag with proper colors and proportions
def draw_indian_flag(x, y, width, height, progress):
    if progress <= 0:
        return
    
    # Calculate the visible height based on hoisting progress
    visible_height = min(height, height * (progress / max_height))
    
    # Flag stays folded until it reaches the top
    reached_top = progress >= max_height * 0.98  # Consider it at top when 98% there
    
    # Apply wind effect - only when flag is at the top
    wind_time = time.time() * 3
    
    if reached_top:
        # Strong wind effect when flag is at the top and unfurled
        wind_strength = 20
        # Unfold the flag gradually after reaching the top
        fold_factor = 0.0  # Fully unfurled
    else:
        # No wind effect while flag is being hoisted
        wind_strength = 0
        # Keep flag completely folded during hoisting
        fold_factor = 0.9  # Tightly folded
    
    wind_effect = wind_strength * math.sin(wind_time)
    
    # Draw the three stripes with proper colors
    stripe_height = flag_height_full / 3
    
    # Calculate the starting position - flag starts at the bottom of the pole and moves up higher
    pole_height = max_height
    flag_start_y = y + pole_height - (progress * 0.9)  # Use dynamic pole height, multiply progress by 0.9 to prevent flag from going too high
    
    # Fold effect - compress the flag horizontally when folded
    folded_width = width * (1 - fold_factor * 0.7)  # Minimum width is 30% of full width when folded
    
    if reached_top:
        # When flag is at the top and unfurled, draw with wind effect
        # Saffron stripe (top)
        saffron_points = [
            (x, flag_start_y),
            (x + folded_width + wind_effect, flag_start_y),
            (x + folded_width + wind_effect * 0.7, flag_start_y + stripe_height),
            (x, flag_start_y + stripe_height)
        ]
        pygame.draw.polygon(screen, SAFFRON, saffron_points)
        
        # White stripe (middle)
        white_points = [
            (x, flag_start_y + stripe_height),
            (x + folded_width + wind_effect * 0.7, flag_start_y + stripe_height),
            (x + folded_width + wind_effect * 0.4, flag_start_y + 2 * stripe_height),
            (x, flag_start_y + 2 * stripe_height)
        ]
        pygame.draw.polygon(screen, WHITE, white_points)
        
        # Green stripe (bottom)
        green_points = [
            (x, flag_start_y + 2 * stripe_height),
            (x + folded_width + wind_effect * 0.4, flag_start_y + 2 * stripe_height),
            (x + folded_width, flag_start_y + 3 * stripe_height),
            (x, flag_start_y + 3 * stripe_height)
        ]
        pygame.draw.polygon(screen, GREEN, green_points)
        
        # Draw Ashoka Chakra in the middle of the white stripe
        chakra_x = x + folded_width // 2 + (wind_effect * 0.55)
        chakra_y = flag_start_y + stripe_height + (stripe_height // 2)
        # Ensure the chakra is drawn at the correct position by centering it
        screen.blit(chakra_image, (int(chakra_x - chakra_radius), int(chakra_y - chakra_radius)))
        
        # Draw a small circle in the center of the chakra for better visibility
        pygame.draw.circle(screen, NAVY_BLUE, (int(chakra_x), int(chakra_y)), 2)
    else:
        # When flag is being hoisted, draw it folded (as a narrow rectangle)
        # Draw all three stripes stacked vertically but with minimal width
        # Saffron stripe (top)
        saffron_rect = pygame.Rect(x, flag_start_y, folded_width, stripe_height)
        pygame.draw.rect(screen, SAFFRON, saffron_rect)
        
        # White stripe (middle)
        white_rect = pygame.Rect(x, flag_start_y + stripe_height, folded_width, stripe_height)
        pygame.draw.rect(screen, WHITE, white_rect)
        
        # Green stripe (bottom)
        green_rect = pygame.Rect(x, flag_start_y + 2 * stripe_height, folded_width, stripe_height)
        pygame.draw.rect(screen, GREEN, green_rect)

def main_loop():
    global flag_height, fireworks, particles, fireworks_active, state
    previous_landmarks = None
    last_firework_time = 0
    celebration_start_time = 0
    clock = pygame.time.Clock()
    
    while True:
        current_time = time.time()
        
        # Process events
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_x and state == "end":
                    return
        
        # Handle different game states
        if state == "hoisting":
            ret, frame = cap.read()
            if not ret:
                continue
                
            # MediaPipe processing
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(frame_rgb)
            
            pulling_detected = False
            
            if results.multi_hand_landmarks:
                landmarks = results.multi_hand_landmarks[0].landmark
                
                # Check for pinching/holding gesture (thumb and index finger close together)
                thumb_tip = landmarks[4]  # Thumb tip
                index_tip = landmarks[8]  # Index finger tip
                
                # Calculate distance between thumb and index finger
                pinch_distance = math.sqrt((thumb_tip.x - index_tip.x)**2 + 
                                          (thumb_tip.y - index_tip.y)**2 + 
                                          (thumb_tip.z - index_tip.z)**2)
                
                # Detect if fingers are pinching (close together)
                is_pinching = pinch_distance < 0.05  # Threshold for pinching
                
                # Detect downward pulling motion while pinching
                if previous_landmarks and is_pinching:
                    # Check if hand is moving downward
                    movement = landmarks[0].y - previous_landmarks[0].y  # Using hand base for movement
                    pulling_detected = movement > 0.01  # Threshold for downward movement
                
                previous_landmarks = landmarks
                
                # Draw pinch points on the camera feed for visual feedback
                h, w, c = frame.shape
                cv2.circle(frame, (int(thumb_tip.x * w), int(thumb_tip.y * h)), 5, (0, 255, 0), -1)
                cv2.circle(frame, (int(index_tip.x * w), int(index_tip.y * h)), 5, (0, 255, 0), -1)
                if is_pinching:
                    cv2.line(frame, (int(thumb_tip.x * w), int(thumb_tip.y * h)),
                             (int(index_tip.x * w), int(index_tip.y * h)), (0, 255, 0), 2)
            
            # Update flag
            if pulling_detected and flag_height < max_height:
                flag_height += 12
                
            # Check if flag reached the top
            if flag_height >= max_height:
                state = "celebration"
                celebration_start_time = current_time
                fireworks_active = True
        
        elif state == "celebration":
            # Add fireworks during celebration
            if fireworks_active and current_time - last_firework_time > 0.3:
                fireworks.append(Firework(random.randint(100, 700), 600))
                last_firework_time = current_time
            
            # Update fireworks
            for fw in fireworks[:]:  # Use a copy for iteration
                if fw.update():
                    fireworks.remove(fw)
            
            # Update particles
            for p in particles[:]:  # Use a copy for iteration
                if p.update():
                    particles.remove(p)
            
            # End celebration after 5 seconds
            if current_time - celebration_start_time > 5:
                fireworks_active = False
                if len(fireworks) == 0 and len(particles) == 0:
                    state = "end"
        
        # Render everything
        screen.blit(background_image, (0, 0))
        
        # Add decorative elements
        if decor_image:
            decor_size = int(screen_width * 0.1)  # 10% of screen width
            scaled_decor = pygame.transform.scale(decor_image, (decor_size, decor_size))
            # Top left corner decoration
            screen.blit(scaled_decor, (int(screen_width * 0.02), int(screen_height * 0.02)))
            # Top right corner decoration
            screen.blit(scaled_decor, (int(screen_width * 0.88), int(screen_height * 0.02)))
            

        
        # Draw pole with shadow effect - extend to bottom of screen
        pole_width = int(screen_width * 0.01)  # 1% of screen width
        pole_full_height = screen_height - pole_y  # Make pole reach bottom of screen
        pygame.draw.rect(screen, (100, 50, 0), (pole_x+3, pole_y+3, pole_width, pole_full_height))  # Shadow
        pygame.draw.rect(screen, BROWN, (pole_x, pole_y, pole_width, pole_full_height))  # Pole
        
        # Draw flag
        if flag_height > 0:
            draw_indian_flag(pole_x + 10, pole_y, flag_width, flag_height_full, flag_height)
        
        # Draw fireworks and particles
        for fw in fireworks:
            fw.draw(screen)
        for p in particles:
            p.draw(screen)
        
        # Show camera feed with border
        if state == "hoisting":
            # Calculate camera feed size based on screen dimensions
            camera_width = int(screen_width * 0.2)  # 20% of screen width
            camera_height = int(camera_width * 0.75)  # 4:3 aspect ratio
            camera_x = int(screen_width * 0.01)  # 1% from left edge
            camera_y = int(screen_height * 0.01)  # 1% from top edge
            
            # Draw camera border
            pygame.draw.rect(screen, (50, 50, 50), (camera_x-2, camera_y-2, camera_width+4, camera_height+4), 2)
            
            # Convert and display camera feed
            frame_surface = pygame.surfarray.make_surface(frame.swapaxes(0, 1))
            screen.blit(pygame.transform.scale(frame_surface, (camera_width, camera_height)), (camera_x, camera_y))
            
            # Draw instructions with background
            instruction_width = int(screen_width * 0.3)  # 30% of screen width
            instruction_height = int(screen_height * 0.08)  # 8% of screen height
            instruction_overlay = pygame.Surface((instruction_width, instruction_height), pygame.SRCALPHA)
            instruction_overlay.fill((255, 255, 255, 180))
            screen.blit(instruction_overlay, (camera_x, camera_y + camera_height + 10))
            
            # Update font sizes based on screen dimensions
            instruction_font = pygame.font.SysFont('Arial', int(screen_height * 0.03))  # 3% of screen height
            
            # Two lines of instructions
            instruction_text1 = instruction_font.render("Pinch your thumb and index finger together", True, (0, 0, 0))
            instruction_text2 = instruction_font.render("Then pull down to hoist the flag", True, (0, 0, 0))
            
            # Position text within the instruction overlay
            text1_x = camera_x + 10
            text1_y = camera_y + camera_height + 15
            text2_y = text1_y + instruction_font.get_height() + 5
            
            screen.blit(instruction_text1, (text1_x, text1_y))
            screen.blit(instruction_text2, (text1_x, text2_y))
        
        # Show celebration message with decorative elements
        if state == "celebration" or state == "end":
            # Create larger text overlay based on screen size
            celebration_overlay_width = int(screen_width * 0.5)  # 50% of screen width
            celebration_overlay_height = int(screen_height * 0.15)  # 15% of screen height
            celebration_overlay = pygame.Surface((celebration_overlay_width, celebration_overlay_height), pygame.SRCALPHA)
            celebration_overlay.fill((255, 255, 255, 180))
            
            # Position overlay in center of screen, lower part
            overlay_x = (screen_width - celebration_overlay_width) // 2
            overlay_y = int(screen_height * 0.7)  # 70% down the screen (lowered further)
            screen.blit(celebration_overlay, (overlay_x, overlay_y))
            
            # Update font sizes based on screen dimensions
            celebration_font = pygame.font.SysFont('Arial', int(screen_height * 0.06))  # 6% of screen height
            date_font = pygame.font.SysFont('Arial', int(screen_height * 0.03))  # 3% of screen height
            
            # Draw celebration text with shadow effect
            celebration_shadow = celebration_font.render("Happy Independence Day!", True, (50, 50, 50))
            celebration_text = celebration_font.render("Happy Independence Day!", True, (255, 165, 0))
            
            # Center the text in the overlay
            shadow_x = overlay_x + (celebration_overlay_width - celebration_shadow.get_width()) // 2 + 2
            shadow_y = overlay_y + 20 + 2
            text_x = overlay_x + (celebration_overlay_width - celebration_text.get_width()) // 2
            text_y = overlay_y + 20
            
            screen.blit(celebration_shadow, (shadow_x, shadow_y))
            screen.blit(celebration_text, (text_x, text_y))
            
            # Draw date
            date_text = date_font.render("August 15, 2025", True, (0, 0, 0))
            date_x = overlay_x + (celebration_overlay_width - date_text.get_width()) // 2
            date_y = text_y + celebration_font.get_height() + 10
            screen.blit(date_text, (date_x, date_y))
            
            # Add JAI HIND text block during celebration - positioned near top above flag
            jai_hind_overlay_width = int(screen_width * 0.3)  # 30% of screen width
            jai_hind_overlay_height = int(screen_height * 0.08)  # 8% of screen height
            jai_hind_overlay = pygame.Surface((jai_hind_overlay_width, jai_hind_overlay_height), pygame.SRCALPHA)
            jai_hind_overlay.fill((255, 255, 255, 200))  # Semi-transparent white
            
            # Position JAI HIND overlay near top center, above flag area
            jai_hind_x = (screen_width - jai_hind_overlay_width) // 2
            jai_hind_y = int(screen_height * 0.03)  # 5% from top - positioned higher above flag post
            screen.blit(jai_hind_overlay, (jai_hind_x, jai_hind_y))
            
            # Draw JAI HIND text with nice styling
            jai_hind_font = pygame.font.SysFont('Arial', int(screen_height * 0.04))  # 4% of screen height
            jai_hind_shadow = jai_hind_font.render("JAI HIND", True, (0, 100, 0))  # Dark green shadow
            jai_hind_text = jai_hind_font.render("JAI HIND", True, (0, 128, 0))  # Vibrant green
            
            # Center the JAI HIND text
            jai_hind_text_x = jai_hind_x + (jai_hind_overlay_width - jai_hind_text.get_width()) // 2
            jai_hind_text_y = jai_hind_y + (jai_hind_overlay_height - jai_hind_text.get_height()) // 2
            
            # Draw shadow and text
            screen.blit(jai_hind_shadow, (jai_hind_text_x + 2, jai_hind_text_y + 2))
            screen.blit(jai_hind_text, (jai_hind_text_x, jai_hind_text_y))
        
        # Show exit message in end state
        if state == "end":
            # Draw exit button with size proportional to screen
            button_width = int(screen_width * 0.2)  # 20% of screen width
            button_height = int(screen_height * 0.06)  # 6% of screen height
            button_x = (screen_width - button_width) // 2
            button_y = int(screen_height * 0.85)  # 85% down the screen
            
            exit_button = pygame.Rect(button_x, button_y, button_width, button_height)
            pygame.draw.rect(screen, (200, 200, 200), exit_button)
            pygame.draw.rect(screen, (100, 100, 100), exit_button, 2)
            
            # Update font size based on screen dimensions
            exit_font = pygame.font.SysFont('Arial', int(screen_height * 0.03))  # 3% of screen height
            exit_text = exit_font.render("Press X to close", True, (0, 0, 0))
            text_rect = exit_text.get_rect(center=exit_button.center)
            screen.blit(exit_text, text_rect)
        
        pygame.display.flip()
        clock.tick(60)  # Cap at 60 FPS

if __name__ == "__main__":
    try:
        main_loop()
    except Exception as e:
        print(f"Error: {e}")
    finally:
        # Clean up resources
        pygame.quit()
        cap.release()
        cv2.destroyAllWindows()
        print("Application closed successfully")
